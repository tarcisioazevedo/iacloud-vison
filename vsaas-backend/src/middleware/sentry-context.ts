import { Request, Response, NextFunction } from 'express'
import * as Sentry from '@sentry/node'

export function sentryContextMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const jwt = req.jwtPayload

  if (jwt) {
    Sentry.setUser({
      id: jwt.sub,
      ...(jwt.role && { role: jwt.role }),
      ...(jwt.integradorId && { integradorId: jwt.integradorId }),
      ...(jwt.clienteFinalId && { clienteFinalId: jwt.clienteFinalId }),
      ...(jwt.impersonatedBy && { impersonatedBy: jwt.impersonatedBy }),
    })
  }

  const tenantCtx = req.tenantContext
  if (tenantCtx?.integradorId) {
    Sentry.setTag('tenant.integradorId', tenantCtx.integradorId)
    Sentry.setTag('tenant.source', tenantCtx.source)
  }

  const reqId = req.id ?? req.headers['x-request-id']
  if (reqId) {
    Sentry.setTag('request_id', String(reqId))
  }

  next()
}
