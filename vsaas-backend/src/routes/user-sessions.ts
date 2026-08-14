/**
 * User Sessions Routes — gestão de sessões ativas.
 *
 * Permite admin:
 *   - Listar sessões ativas dum user (GET /users/:id/sessions)
 *   - Revogar 1 sessão específica (POST /users/:id/sessions/:sessionId/revoke)
 *   - Revogar TODAS sessões do user (POST /users/:id/sessions/revoke-all)
 *
 * Sessões são criadas no login (auth.ts) e atualizadas em cada request
 * autenticado via middleware. Revogadas viram 401 no próximo request.
 *
 * Sprint A · docs/40-PLAN-GESTAO-USUARIOS.md
 */
import { Router } from 'express'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { publicRoute } from '../middleware/require-capability'
import { NotFoundError, ForbiddenError } from '../lib/errors'
import { logger } from '../lib/logger'

export const userSessionsRouter = Router({ mergeParams: true })
userSessionsRouter.use(requireAuth)

// Helper: garante que o user alvo está no escopo de quem chama (mesma lógica que users.ts)
async function loadUserInScope(jwt: any, userId: string) {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, role: true,
      integradorId: true, clienteFinalId: true,
    },
  })
  if (!target) throw new NotFoundError('User')

  // Self-logout permitido pra qualquer role (encerrar a própria sessão é direito básico).
  if (target.id === jwt.sub) return target

  if (jwt.role === 'SUPER_ADMIN' || jwt.role === 'ADMIN_GLOBAL') return target
  if (jwt.role === 'INTEGRADOR_ADMIN') {
    if (target.integradorId !== jwt.integradorId) throw new ForbiddenError('Fora do tenant')
    return target
  }
  if (jwt.role === 'CLIENTE_ADMIN') {
    if (target.clienteFinalId !== jwt.clienteFinalId) throw new ForbiddenError('Fora do tenant')
    if (target.role !== 'CLIENTE_OPERADOR' && target.role !== 'CLIENTE_VIEWER' && target.role !== 'CLIENTE_SUPERVISOR') {
      throw new ForbiddenError('CLIENTE_ADMIN só gerencia SUPERVISOR/OPERADOR/VIEWER')
    }
    return target
  }
  throw new ForbiddenError('Sem permissão')
}

// ── GET /users/:userId/sessions ──────────────────────────────────────────────
userSessionsRouter.get('/',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    const userId = String(req.params.userId)
    await loadUserInScope(jwt, userId)

    const now = new Date()
    const sessions = await prisma.userSession.findMany({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
      take: 100,
    })

    // Enriquece: marca como "online" se viu < 5min e não revogada/expirada
    const enriched = sessions.map(s => ({
      id: s.id,
      device: s.device,
      ip: s.ip,
      lastSeenAt: s.lastSeenAt,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      revokedAt: s.revokedAt,
      revokedReason: s.revokedReason,
      active: !s.revokedAt && s.expiresAt > now,
      online: !s.revokedAt && s.expiresAt > now &&
              (now.getTime() - s.lastSeenAt.getTime()) < 5 * 60_000,
    }))

    res.json({ sessions: enriched })
  })
)

// ── POST /users/:userId/sessions/:sessionId/revoke ───────────────────────────
userSessionsRouter.post('/:sessionId/revoke',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    const userId = String(req.params.userId)
    const sessionId = String(req.params.sessionId)
    await loadUserInScope(jwt, userId)

    // P0 audit fix — amarra sessionId AO userId (sem isso, qualquer admin
    // dentro do escopo conseguia revogar sessão de outro tenant passando
    // o sessionId direto).
    const session = await prisma.userSession.findFirst({
      where:  { id: sessionId, userId },
      select: { id: true, userId: true },
    })
    if (!session) {
      throw new NotFoundError('UserSession')
    }

    const updated = await prisma.userSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date(), revokedReason: 'admin_revoke' },
    })

    await prisma.auditLog.create({
      data: {
        action: 'USER_SESSION_REVOKED',
        resource: 'UserSession',
        resourceId: sessionId,
        userId: jwt.sub,
        clienteFinalId: jwt.clienteFinalId ?? null,
        integradorId: jwt.integradorId ?? null,
        metadataJson: { targetUserId: userId },
      },
    }).catch(() => { /* best-effort */ })

    logger.info({ userId, sessionId, revokedBy: jwt.sub }, 'user_session_revoked')
    res.json({ ok: true, sessionId: updated.id })
  })
)

// ── POST /users/:userId/sessions/revoke-all ──────────────────────────────────
// Força logout total do usuário. Útil em demissão.
userSessionsRouter.post('/revoke-all',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const jwt = req.jwtPayload!
    const userId = String(req.params.userId)
    await loadUserInScope(jwt, userId)

    const result = await prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'admin_revoke' },
    })

    await prisma.auditLog.create({
      data: {
        action: 'USER_ALL_SESSIONS_REVOKED',
        resource: 'User',
        resourceId: userId,
        userId: jwt.sub,
        clienteFinalId: jwt.clienteFinalId ?? null,
        integradorId: jwt.integradorId ?? null,
        metadataJson: { count: result.count },
      },
    }).catch(() => {})

    logger.info({ userId, count: result.count, revokedBy: jwt.sub }, 'user_all_sessions_revoked')
    res.json({ ok: true, revoked: result.count })
  })
)
