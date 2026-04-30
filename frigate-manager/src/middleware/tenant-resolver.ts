// ============================================================
// IA Cloud Vision — Tenant Resolver Middleware
// Extracts tenant ID from request context (JWT/header)
// ============================================================

import { Request, Response, NextFunction } from 'express';

/**
 * Middleware that resolves the tenant ID from the request.
 *
 * Supports multiple sources (in priority order):
 * 1. x-tenant-id header (for API/service-to-service calls)
 * 2. JWT token payload (req.user.tenantId — set by your auth middleware)
 * 3. Query parameter ?tenantId= (for development/testing)
 *
 * Sets req.headers['x-tenant-id'] for downstream middleware.
 */
export function tenantResolver(req: Request, res: Response, next: NextFunction): void {
  // Priority 1: Explicit header
  let tenantId = req.headers['x-tenant-id'] as string | undefined;

  // Priority 2: JWT payload (set by auth middleware like passport/jose)
  if (!tenantId && (req as any).user?.tenantId) {
    tenantId = (req as any).user.tenantId;
  }

  // Priority 3: Query parameter (dev/testing only)
  if (!tenantId && req.query.tenantId) {
    tenantId = req.query.tenantId as string;
  }

  if (!tenantId) {
    res.status(401).json({
      error: 'Tenant context required',
      message: 'Provide x-tenant-id header, JWT with tenantId claim, or ?tenantId query parameter',
    });
    return;
  }

  // Normalize and set for downstream
  req.headers['x-tenant-id'] = tenantId;
  next();
}
