/**
 * Impersonation — Lote 5 (+ extensão: integrador impersona seus clientes)
 *
 * Atores autorizados:
 *   - SUPER_ADMIN     → pode impersonar QUALQUER integrador OU cliente final
 *   - INTEGRADOR_ADMIN → pode impersonar SOMENTE clientes finais do PRÓPRIO
 *                        integradorId, e SOMENTE com role CLIENTE_* (nunca
 *                        outro INTEGRADOR_*, nunca SUPER_ADMIN, nunca cliente
 *                        de outro integrador)
 *
 * Auditoria forte: toda ação executada fica registrada com `actorId` +
 * `actorRole` na ImpersonationSession e no AuditLog (via superAdminId
 * quando ator é fabricante, integradorId quando ator é integrador).
 *
 * Fluxo:
 *   1. POST /auth/impersonate  { clienteFinalId, targetRole, reason, ... }
 *      → cria ImpersonationSession + retorna token JWT de curta duração
 *      → JWT carrega impersonatedBy + impersonatorRole no payload
 *
 *   2. Frontend detecta `impersonatedBy` → mostra banner "Você está como X"
 *
 *   3. POST /auth/impersonate/end  → encerra sessão (marca endedAt)
 *
 *   4. GET  /auth/impersonate/sessions (SUPER_ADMIN) → lista sessões ativas
 *
 * Bloqueios de segurança:
 *   - Impersonação em cadeia é proibida (não dá pra impersonar dentro de
 *     uma sessão já impersonada)
 *   - Auto-impersonação proibida
 *   - Integrador NÃO pode usar `targetUserId` ou `integradorId` direto —
 *     somente `clienteFinalId`, e o backend valida o vínculo
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
  targetUserId:   z.string().uuid().optional(),
  integradorId:   z.string().uuid().optional(),
  clienteFinalId: z.string().uuid().optional(),
  /** Role específico do nível impersonado: INTEGRADOR_ADMIN | CLIENTE_ADMIN | CLIENTE_OPERADOR */
  targetRole:     z.enum(['INTEGRADOR_ADMIN', 'INTEGRADOR_TECNICO', 'CLIENTE_ADMIN', 'CLIENTE_OPERADOR', 'CLIENTE_VIEWER']).optional(),
  /** Duração em segundos (15min=900, 1h=3600, 4h=14400). Default: 900 */
  durationSeconds: z.number().int().min(60).max(14400).optional(),
  /** Motivo OBRIGATÓRIO em Onda 9 (auditoria LGPD) */
  reason:          z.string().min(10).max(500),
  /** Checkbox de ciência LGPD — frontend obriga */
  acknowledged:    z.boolean().refine(v => v === true, { message: 'É necessário concordar que ações ficarão visíveis ao cliente (LGPD)' }),
}).refine(d => d.targetUserId || d.integradorId || d.clienteFinalId, { message: 'Informe targetUserId, integradorId ou clienteFinalId' })

// Roles permitidos para INTEGRADOR_ADMIN como targetRole — nunca pode virar
// outro integrador, nunca super-admin, nunca técnico de outro tenant.
const INTEGRADOR_ALLOWED_TARGET_ROLES = ['CLIENTE_ADMIN', 'CLIENTE_OPERADOR', 'CLIENTE_VIEWER'] as const

impersonationRouter.post(
  '/',
  requireAuth,
  requireRole('SUPER_ADMIN', 'INTEGRADOR_ADMIN'),
  asyncHandler(async (req, res) => {
    const parse = StartSchema.safeParse(req.body)
    if (!parse.success) throw new ValidationError(parse.error.issues[0]?.message ?? 'Dados inválidos')

    let { targetUserId, reason } = parse.data
    const { integradorId, clienteFinalId, targetRole, durationSeconds } = parse.data
    const actorId = req.jwtPayload!.sub
    const actorRole = req.jwtPayload!.role as 'SUPER_ADMIN' | 'INTEGRADOR_ADMIN'
    const actorIntegradorId = req.jwtPayload!.integradorId
    const expiresInSec = durationSeconds ?? 900  // default 15min

    // ── Bloqueio: impersonação em cadeia ─────────────────────────────────────
    // Se o JWT atual já é fruto de uma impersonação, não permitimos iniciar
    // uma nova. Cadeia (super → integ → cliente) abriria brecha de auditoria
    // e dificultaria revogar sessões com segurança.
    if (req.jwtPayload!.impersonatedBy) {
      throw new ForbiddenError('Não é permitido iniciar impersonação dentro de uma sessão já impersonada')
    }

    // ── Restrições específicas para INTEGRADOR_ADMIN ────────────────────────
    if (actorRole === 'INTEGRADOR_ADMIN') {
      if (!actorIntegradorId) {
        throw new ForbiddenError('Token sem integradorId — sessão inválida')
      }
      // Integrador só pode usar clienteFinalId — bloqueia targetUserId/integradorId direto
      if (targetUserId || integradorId) {
        throw new ForbiddenError('Integrador só pode impersonar via clienteFinalId')
      }
      if (!clienteFinalId) {
        throw new ValidationError('Informe clienteFinalId para impersonar um cliente do seu tenant')
      }
      // targetRole, se informado, deve estar no allowlist CLIENTE_*
      if (targetRole && !(INTEGRADOR_ALLOWED_TARGET_ROLES as readonly string[]).includes(targetRole)) {
        throw new ForbiddenError(`Integrador só pode impersonar como ${INTEGRADOR_ALLOWED_TARGET_ROLES.join(' / ')}`)
      }
      // Valida vínculo: clienteFinal pertence ao integrador do ator
      const cliente = await prisma.clienteFinal.findUnique({
        where: { id: clienteFinalId },
        select: { id: true, integradorId: true, active: true, name: true },
      })
      if (!cliente) throw new NotFoundError('Cliente final')
      if (cliente.integradorId !== actorIntegradorId) {
        throw new ForbiddenError('Cliente final não pertence ao seu tenant')
      }
      if (!cliente.active) {
        throw new ForbiddenError('Cliente final inativo — não é possível impersonar')
      }
    }

    // Se passou integradorId, busca usuário do role solicitado (apenas SUPER_ADMIN chega aqui)
    if (integradorId && !targetUserId) {
      const role = targetRole ?? 'INTEGRADOR_ADMIN'
      const user = await prisma.user.findFirst({
        where: { integradorId, role, active: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      })
      if (!user) throw new NotFoundError(`Nenhum ${role} ativo encontrado para este integrador`)
      targetUserId = user.id
    }

    // Se passou clienteFinalId, busca usuário do role solicitado (CLIENTE_ADMIN/OPERADOR/VIEWER)
    if (clienteFinalId && !targetUserId) {
      const role = targetRole ?? 'CLIENTE_ADMIN'
      const user = await prisma.user.findFirst({
        where: { clienteFinalId, role, active: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      })
      if (!user) throw new NotFoundError(`Nenhum ${role} ativo encontrado para este cliente final`)
      targetUserId = user.id
    }

    // Impersonar a si mesmo é sem sentido
    if (targetUserId === actorId) {
      throw new ValidationError('Não é possível se impersonar')
    }

    const target = await prisma.user.findUnique({
      where: { id: targetUserId! },
      select: { id: true, email: true, role: true, integradorId: true, clienteFinalId: true, active: true },
    })
    if (!target) throw new NotFoundError('Usuário alvo')
    if (!target.active) throw new ForbiddenError('Usuário inativo — não é possível impersonar')

    // ── Defesa em profundidade: revalida vínculo do alvo p/ integrador ─────
    // Mesmo se o user-lookup acima falhar, garantimos que o target pertence
    // ao integrador do ator e que o role é CLIENTE_*.
    if (actorRole === 'INTEGRADOR_ADMIN') {
      if (target.integradorId !== actorIntegradorId) {
        throw new ForbiddenError('Usuário alvo não pertence ao seu tenant')
      }
      if (!(INTEGRADOR_ALLOWED_TARGET_ROLES as readonly string[]).includes(target.role)) {
        throw new ForbiddenError(`Integrador só pode impersonar usuários ${INTEGRADOR_ALLOWED_TARGET_ROLES.join(' / ')}`)
      }
    }

    const secret = process.env.JWT_SECRET
    if (!secret) throw new Error('JWT_SECRET not configured')

    // JWT com duração customizada + flag de impersonação + countdown
    const impersonateToken = jwt.sign(
      {
        sub:             target.id,
        role:            target.role,
        integradorId:    target.integradorId ?? undefined,
        clienteFinalId:  target.clienteFinalId ?? undefined,
        impersonatedBy:  actorId,
        impersonatorRole: actorRole,
        impersonationExpiresAt: Math.floor(Date.now() / 1000) + expiresInSec,
      },
      secret,
      { expiresIn: expiresInSec },
    )

    // Registra sessão com ator + role.
    const session = await prisma.impersonationSession.create({
      data: {
        actorId,
        actorRole,
        targetUserId: target.id,
        reason,
        ipAddress: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      },
    })

    // Audit (Onda 9: + duração + acknowledged + IP). Quando o ator é
    // fabricante, gravamos em superAdminId; quando é integrador, em
    // integradorId — assim cada audit log fica scoped corretamente.
    await prisma.auditLog.create({
      data: {
        ...(actorRole === 'SUPER_ADMIN'
          ? { superAdminId: actorId }
          : { integradorId: actorIntegradorId, userId: actorId }),
        action:       'IMPERSONATION_START',
        resource:     'User',
        resourceId:   target.id,
        metadataJson: {
          reason,
          sessionId: session.id,
          actorRole,
          targetRole: target.role,
          durationSeconds: expiresInSec,
          acknowledged: true,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
        },
      },
    })

    logger.warn({
      actorId,
      actorRole,
      targetUserId: target.id,
      targetRole:   target.role,
      sessionId:    session.id,
      reason,
    }, 'impersonation_started')

    res.json({
      token:   impersonateToken,
      session: { id: session.id, startedAt: session.startedAt },
      target:  { id: target.id, email: target.email, role: target.role },
      // Onda 9: duração explícita + timestamp final para countdown UI
      expiresInSeconds: expiresInSec,
      expiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString(),
    })
  }),
)

// ── POST /auth/impersonate/end ────────────────────────────────────────────────

impersonationRouter.post(
  '/end',
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = req.jwtPayload!

    // Funciona pra:
    //  - ator (SUPER_ADMIN ou INTEGRADOR_ADMIN) encerrar remotamente
    //  - usuário "impersonado" encerrar sua própria sessão (impersonatedBy presente)
    const isImpersonated = !!payload.impersonatedBy
    const sessionId = req.body?.sessionId as string | undefined
    const isAuthorizedActor = payload.role === 'SUPER_ADMIN' || payload.role === 'INTEGRADOR_ADMIN'

    if (!isImpersonated && !isAuthorizedActor) {
      throw new ForbiddenError('Apenas sessões de impersonação ou SUPER_ADMIN/INTEGRADOR_ADMIN podem encerrar sessões')
    }

    let where: any = {}
    if (sessionId) {
      where = { id: sessionId }
    } else if (isImpersonated) {
      // Encerra a sessão ativa mais recente do sub
      where = { targetUserId: payload.sub, endedAt: null }
    } else {
      // Ator encerrando por targetUserId
      if (!req.body?.targetUserId) throw new ValidationError('Informe sessionId ou targetUserId')
      where = { targetUserId: req.body.targetUserId, endedAt: null }
    }

    const session = await prisma.impersonationSession.findFirst({ where })
    if (!session) {
      return res.json({ ok: true, message: 'Sessão não encontrada ou já encerrada' })
    }

    // Defesa: integrador só pode encerrar sessões que ele próprio iniciou
    // (ou a própria, se está dentro de uma sessão impersonada).
    if (!isImpersonated && payload.role === 'INTEGRADOR_ADMIN' && session.actorId !== payload.sub) {
      throw new ForbiddenError('Você só pode encerrar sessões iniciadas por você')
    }

    await prisma.impersonationSession.update({
      where: { id: session.id },
      data:  { endedAt: new Date(), endedReason: 'manual' },
    })

    // Audit log do END — mantém scope correto (super-admin vs integrador).
    const endActorId  = isImpersonated ? payload.impersonatedBy! : payload.sub
    const endActorRole = isImpersonated ? (payload.impersonatorRole ?? 'SUPER_ADMIN') : payload.role
    await prisma.auditLog.create({
      data: {
        ...(endActorRole === 'SUPER_ADMIN'
          ? { superAdminId: endActorId }
          : { integradorId: payload.integradorId, userId: endActorId }),
        action:       'IMPERSONATION_END',
        resource:     'User',
        resourceId:   session.targetUserId,
        metadataJson: { sessionId: session.id, actorRole: endActorRole },
      },
    })

    logger.info({ sessionId: session.id, endActorRole }, 'impersonation_ended')
    res.json({ ok: true, sessionId: session.id })
  }),
)

// ── GET /auth/impersonate/sessions ────────────────────────────────────────────

impersonationRouter.get(
  '/sessions',
  requireAuth,
  requireRole('SUPER_ADMIN', 'INTEGRADOR_ADMIN'),
  asyncHandler(async (req, res) => {
    const active = req.query.active === 'true'
    const payload = req.jwtPayload!

    // Scope:
    //  - SUPER_ADMIN     → todas as sessões
    //  - INTEGRADOR_ADMIN → só as sessões que ele próprio iniciou
    const where: any = active ? { endedAt: null } : {}
    if (payload.role === 'INTEGRADOR_ADMIN') {
      where.actorId = payload.sub
    }

    const sessions = await prisma.impersonationSession.findMany({
      where,
      include: {
        target: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { startedAt: 'desc' },
      take: 100,
    })
    res.json({ sessions, total: sessions.length })
  }),
)
