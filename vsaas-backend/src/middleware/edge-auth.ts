/**
 * Autenticação de Edge Nodes via apiToken (Bearer).
 * Injeta edgeNode e integradorId no request.
 */
import { Request, Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { UnauthorizedError } from '../lib/errors'

declare global {
  namespace Express {
    interface Request {
      edgeNode?: {
        id: string
        siteId: string
        integradorId: string
      }
    }
  }
}

// Cache simples em memória (TTL 5min) para evitar query a cada frame
const tokenCache = new Map<string, { edgeNode: NonNullable<Request['edgeNode']>; exp: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000

export async function requireEdgeAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) throw new UnauthorizedError('Edge token ausente')

  const token = header.slice(7)

  // Checar cache
  const cached = tokenCache.get(token)
  if (cached && cached.exp > Date.now()) {
    req.edgeNode = cached.edgeNode
    return next()
  }

  const node = await prisma.edgeNode.findUnique({
    where: { apiToken: token },
    include: { site: { select: { clienteFinalId: true, clienteFinal: { select: { integradorId: true } } } } },
  })

  if (!node || node.status === 'OFFLINE') {
    throw new UnauthorizedError('Edge token inválido ou node offline')
  }

  const payload = {
    id: node.id,
    siteId: node.siteId,
    integradorId: node.site.clienteFinal.integradorId,
  }

  tokenCache.set(token, { edgeNode: payload, exp: Date.now() + CACHE_TTL_MS })
  req.edgeNode = payload
  next()
}
