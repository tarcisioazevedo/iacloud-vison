import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { UnauthorizedError } from '../lib/errors'

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
    req.jwtPayload = jwt.verify(token, secret) as JwtPayload
    next()
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
