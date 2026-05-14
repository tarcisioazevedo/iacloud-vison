import { Request, Response, NextFunction } from 'express'
import { UnauthorizedError } from '../lib/errors'
import { requireEdgeAuth } from './edge-auth'

const AI_WORKER_SECRET = process.env.AI_WORKER_SECRET ?? ''

export function requireAiWorkerAuth(
  req: Request, _res: Response, next: NextFunction,
): void {
  if (!AI_WORKER_SECRET) throw new UnauthorizedError('AI_WORKER_SECRET não configurado')
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) throw new UnauthorizedError('AI worker token ausente')
  if (header.slice(7) !== AI_WORKER_SECRET) throw new UnauthorizedError('AI worker token inválido')
  next()
}

/** Aceita EdgeNode auth OU AI Worker auth — usado em /detections/ingest. */
export function requireEdgeOrAiWorkerAuth(
  req: Request, res: Response, next: NextFunction,
): void {
  const header = req.headers.authorization ?? ''
  const token  = header.startsWith('Bearer ') ? header.slice(7) : ''
  // AI worker: comparação simples, sem DB lookup
  if (AI_WORKER_SECRET && token === AI_WORKER_SECRET) {
    req.aiWorkerAuthenticated = true
    return next()
  }
  // Fallback: edge node auth normal (verifica DB)
  requireEdgeAuth(req, res, next)
}

declare global {
  namespace Express {
    interface Request {
      aiWorkerAuthenticated?: boolean
    }
  }
}
