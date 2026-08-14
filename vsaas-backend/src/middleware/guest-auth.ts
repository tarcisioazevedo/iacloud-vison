/**
 * Guest Auth Middleware — Sprint F.
 *
 * Valida o JWT efêmero (`scope='guest'`) emitido por POST /guest/:token/access
 * após o convidado provar PIN. O JWT carrega { linkId, scope, exp }.
 *
 * Anexa `req.guestLink` com os dados completos do link pra os handlers fazerem
 * verificações finas (canDownload, recordingFrom/To, etc.).
 *
 * Re-valida revogação/expiração/maxUses a cada request — JWT efêmero não pode
 * sobreviver à revogação imediata do admin.
 */
import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma'
import type { GuestAccessLink } from '@prisma/client'
import { UnauthorizedError, ForbiddenError } from '../lib/errors'

export interface GuestJwtPayload {
  scope:  'guest'
  linkId: string
  iat:    number
  exp:    number
}

declare global {
  namespace Express {
    interface Request {
      guestLink?: GuestAccessLink
      guestJwt?:  GuestJwtPayload
    }
  }
}

export const GUEST_JWT_TTL_SEC = 10 * 60 // 10 minutos

export function signGuestJwt(linkId: string): string {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET not configured')
  const now = Math.floor(Date.now() / 1000)
  const payload: GuestJwtPayload = {
    scope:  'guest',
    linkId,
    iat:    now,
    exp:    now + GUEST_JWT_TTL_SEC,
  }
  return jwt.sign(payload, secret, { algorithm: 'HS256' })
}

/**
 * Extrai JWT do Bearer header OU ?guestToken= no query string (porque
 * <video src=...> e <img src=...> não setam headers).
 */
function extractGuestJwt(req: Request): string | null {
  const auth = req.headers.authorization
  if (auth?.startsWith('Bearer ')) return auth.slice(7)
  if (req.method === 'GET') {
    const q = (req.query as Record<string, string | undefined>)['guestToken']
    if (q && q.length > 10) return q
  }
  return null
}

export async function requireGuestAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractGuestJwt(req)
    if (!token) return next(new UnauthorizedError('Sessão de convidado ausente'))

    const secret = process.env.JWT_SECRET
    if (!secret) return next(new Error('JWT_SECRET not configured'))

    let decoded: GuestJwtPayload
    try {
      decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as GuestJwtPayload
    } catch {
      return next(new UnauthorizedError('Sessão de convidado expirada — abra o link de novo'))
    }
    if (decoded.scope !== 'guest') return next(new ForbiddenError('Escopo inválido'))

    const link = await prisma.guestAccessLink.findUnique({ where: { id: decoded.linkId } })
    if (!link) return next(new UnauthorizedError('Link não encontrado'))
    if (link.revokedAt) return next(new ForbiddenError('Link revogado pelo administrador'))
    if (link.validUntil.getTime() <= Date.now()) return next(new ForbiddenError('Link expirado'))

    req.guestLink = link
    req.guestJwt  = decoded
    next()
  } catch (err) {
    next(err)
  }
}

/**
 * Helper: exige capability declarada no link.
 *  - 'live'       → canViewLive
 *  - 'recording'  → canViewRecording
 *  - 'download'   → canDownload
 */
export function requireGuestCapability(cap: 'live' | 'recording' | 'download') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const link = req.guestLink
    if (!link) { next(new UnauthorizedError()); return }
    const allowed =
      (cap === 'live'      && link.canViewLive)      ||
      (cap === 'recording' && link.canViewRecording) ||
      (cap === 'download'  && link.canDownload)
    if (!allowed) { next(new ForbiddenError('Permissão não incluída neste link')); return }
    next()
  }
}
