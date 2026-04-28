/**
 * blockReadOnly — Lote 2
 *
 * Impede que roles somente-leitura (CLIENTE_SUPERVISOR) executem mutations
 * (POST/PATCH/PUT/DELETE). Aplicado em routers de recursos mutáveis:
 * cameras, sites, users, triggers, review/rules, faces, plates.
 *
 * GET, HEAD, OPTIONS passam sem restrição — toda a leitura é permitida.
 */
import { Request, Response, NextFunction } from 'express'
import { ForbiddenError } from '../lib/errors'

const READ_ONLY_ROLES = new Set(['CLIENTE_SUPERVISOR'])
const SAFE_METHODS    = new Set(['GET', 'HEAD', 'OPTIONS'])

export function blockReadOnly(req: Request, _res: Response, next: NextFunction): void {
  const role = req.jwtPayload?.role
  if (role && READ_ONLY_ROLES.has(role) && !SAFE_METHODS.has(req.method)) {
    next(new ForbiddenError('Perfil somente-leitura não pode executar esta operação'))
    return
  }
  next()
}
