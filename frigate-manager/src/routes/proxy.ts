// ============================================================
// IA Cloud Vision — Proxy Routes
// Express router that mounts the Frigate proxy middleware
// ============================================================

import { Router } from 'express';
import { tenantResolver } from '../middleware/tenant-resolver';
import { frigateProxyMiddleware } from '../services/frigate-proxy';

export const proxyRouter = Router();

/**
 * All requests to /api/frigate/* are resolved to the tenant's
 * Frigate instance and proxied transparently.
 *
 * Examples:
 *   GET  /api/frigate/stats        → Frigate /api/stats
 *   GET  /api/frigate/events       → Frigate /api/events
 *   GET  /api/frigate/metrics      → Frigate /api/metrics
 *   GET  /api/frigate/{cam}/latest.jpg → Frigate /api/{cam}/latest.jpg
 *   POST /api/frigate/events/{id}/description → Frigate POST
 */
proxyRouter.all('/*', tenantResolver, frigateProxyMiddleware);
