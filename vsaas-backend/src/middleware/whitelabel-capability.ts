/**
 * Middleware: requireWhitelabelCapability(capability)
 *
 * Bloqueia request se integrador (via JWT/tenantContext) não tem a capability.
 * SUPER_ADMIN sempre passa (suporte/debug).
 *
 * Usage:
 *   app.use('/me/integrador/pricing', requireWhitelabelCapability('pricing'), mePricingRouter)
 */
import type { Request, Response, NextFunction } from 'express'
import { hasCapability, type WhitelabelCapabilities } from '../services/whitelabel.service'
import { resolveIntegradorId } from './tenant-context'
import { logger } from '../lib/logger'

export function requireWhitelabelCapability(capability: keyof WhitelabelCapabilities) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const role = req.jwtPayload?.role
    if (role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL') {
      next()
      return
    }

    const integradorId = resolveIntegradorId(req)
    if (!integradorId) {
      res.status(401).json({ error: 'no_tenant_context', capability })
      return
    }

    try {
      const ok = await hasCapability(integradorId, capability)
      if (!ok) {
        res.status(403).json({
          error: 'whitelabel_capability_required',
          capability,
          message: `Esta funcionalidade requer o tier white-label apropriado. Capability ausente: ${capability}.`,
        })
        return
      }
      next()
    } catch (err) {
      logger.error({ err, capability }, 'whitelabel_capability_check_failed')
      res.status(503).json({ error: 'capability_check_unavailable' })
    }
  }
}
