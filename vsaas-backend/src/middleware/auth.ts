import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { UnauthorizedError } from '../lib/errors'
import { prisma } from '../lib/prisma'

// Cache em memória de existência de User (60s TTL) para evitar 1 query por
// request. Invalidação automática por expiração — se um user for desativado,
// no máximo 60s depois ele será barrado.
const userActiveCache = new Map<string, { active: boolean; expiresAt: number }>()
const USER_CACHE_TTL_MS = 60_000

async function isUserStillActive(userId: string): Promise<boolean> {
  // Sub virtuais (portal, box) não correspondem a entidade — sempre passa.
  if (userId.startsWith('portal:') || userId.startsWith('box:')) return true

  const now = Date.now()
  const cached = userActiveCache.get(userId)
  if (cached && cached.expiresAt > now) return cached.active

  // Login resolve actor em 3 tabelas: SuperAdmin, Integrador, User.
  // Verifica em paralelo — primeira que casar valida.
  const [user, superAdmin, integrador] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { active: true } }),
    prisma.superAdmin.findUnique({ where: { id: userId }, select: { active: true } }).catch(() => null),
    prisma.integrador.findUnique({ where: { id: userId }, select: { active: true } }).catch(() => null),
  ])
  const active =
    (!!user && user.active) ||
    (!!superAdmin && superAdmin.active) ||
    (!!integrador && integrador.active)
  userActiveCache.set(userId, { active, expiresAt: now + USER_CACHE_TTL_MS })
  return active
}

export interface JwtPayload {
  sub: string           // userId
  role: string
  integradorId?: string
  clienteFinalId?: string
  impersonatedBy?: string  // Lote 5: set when SUPER_ADMIN is impersonating
  iat: number
  exp: number
}

declare global {
  namespace Express {
    interface Request {
      jwtPayload?: JwtPayload
    }
  }
}

/**
 * Autenticação baseada em Bearer JWT.
 *
 * Usa `next(err)` em vez de `throw` — em Node 20, throw em middleware que é
 * eventualmente chamado de contexto async pode virar unhandledRejection em
 * alguns caminhos. next(err) é o contrato idiomático do Express e vai direto
 * pro errorHandler global.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  // Bearer no header (caminho normal) OU ?token=... no query (para SSE/EventSource
  // que não suporta headers customizados). Query param só é aceito em GET.
  const header = req.headers.authorization
  let token: string | null = null

  if (header?.startsWith('Bearer ')) {
    token = header.slice(7)
  } else if (req.method === 'GET') {
    const q = (req.query as Record<string, string | undefined>)['token']
    if (q && q.length > 10) token = q
  }

  if (!token) {
    next(new UnauthorizedError())
    return
  }

  const secret = process.env.JWT_SECRET
  if (!secret) {
    next(new Error('JWT_SECRET not configured'))
    return
  }

  try {
    const payload = jwt.verify(token, secret) as JwtPayload
    req.jwtPayload = payload
    // Defesa contra JWT órfão: rejeita se o User foi removido/desativado após
    // a emissão do token (cenário de seed reset, exclusão administrativa).
    isUserStillActive(payload.sub).then(ok => {
      if (!ok) {
        next(new UnauthorizedError('Sessão inválida — refaça login'))
        return
      }
      next()
    }).catch(() => {
      // Erro de DB não deve barrar — degrada gracioso (libera, log warn).
      next()
    })
  } catch {
    next(new UnauthorizedError('Token inválido ou expirado'))
  }
}

/**
 * Decodifica o Bearer JWT se presente — sem enforcement.
 *
 * Use ANTES do rate limiter para que `req.jwtPayload` esteja disponível na
 * keyGenerator (rate limit por tenant). Endpoints que precisam de auth
 * continuam protegidos pelo `requireAuth` colocado no router específico.
 *
 * Não loga falha — JWT inválido/ausente é OK aqui (o requireAuth depois
 * que decide se barra ou não).
 */
export function softAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    next()
    return
  }
  const secret = process.env.JWT_SECRET
  if (!secret) {
    next()
    return
  }
  try {
    req.jwtPayload = jwt.verify(header.slice(7), secret) as JwtPayload
  } catch {
    // ignora — token inválido vira não-autenticado para rate limit
  }
  next()
}

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.jwtPayload) {
      next(new UnauthorizedError())
      return
    }
    if (!roles.includes(req.jwtPayload.role)) {
      next(new UnauthorizedError(`Role '${req.jwtPayload.role}' não tem acesso`))
      return
    }
    next()
  }
}
