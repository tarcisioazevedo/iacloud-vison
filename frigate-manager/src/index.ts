// ============================================================
// IA Cloud Vision — Frigate Manager
// Multi-tenant Frigate instance orchestration module
// ============================================================
//
// Usage in your VSaaS backend:
//
//   import { mountFrigateManager } from '@iacloudvision/frigate-manager';
//   mountFrigateManager(app);
//
// Or run standalone for testing:
//   npx ts-node src/index.ts
//

import express from 'express';
import { adminRouter } from './routes/admin';
import { proxyRouter } from './routes/proxy';

// ── Re-exports for programmatic usage ──────────────────────

export { registerInstance, removeInstance, listInstances, getBaseUrl, checkInstanceHealth } from './services/instance-registry';
export { frigateProxyMiddleware, getFrigateStreamUrl, getFrigateSnapshotUrl } from './services/frigate-proxy';
export { generateFrigateConfig, generateGo2rtcConfig } from './services/config-generator';
export { provisionInstance, destroyInstance } from './services/docker-provisioner';
export { tenantResolver } from './middleware/tenant-resolver';
export { adminRouter } from './routes/admin';
export { proxyRouter } from './routes/proxy';
export * from './types';

// ── Mount helper for Express apps ──────────────────────────

/**
 * Mount the Frigate Manager routes into an existing Express app.
 *
 * This adds:
 *   /frigate-manager/*  → Admin routes (instance CRUD, health)
 *   /api/frigate/*      → Tenant-aware proxy to Frigate instances
 */
export function mountFrigateManager(app: express.Application): void {
  app.use('/frigate-manager', adminRouter);
  app.use('/api/frigate', proxyRouter);
  console.log('[FrigateManager] Routes mounted: /frigate-manager/* and /api/frigate/*');
}

// ── Standalone server (for testing) ────────────────────────

if (require.main === module) {
  const app = express();
  app.use(express.json());

  mountFrigateManager(app);

  // Landing page
  app.get('/', (_req, res) => {
    res.json({
      service: 'IA Cloud Vision — Frigate Manager',
      version: '1.0.0',
      endpoints: {
        admin: {
          'POST /frigate-manager/instances': 'Register a Frigate instance',
          'GET /frigate-manager/instances': 'List all instances',
          'DELETE /frigate-manager/instances/:tenantId': 'Remove instance',
          'GET /frigate-manager/instances/:tenantId/health': 'Health check',
          'GET /frigate-manager/health': 'Health of all instances',
          'POST /frigate-manager/generate-config': 'Preview config.yml',
        },
        proxy: {
          'ALL /api/frigate/*': 'Proxy to tenant Frigate (requires x-tenant-id header)',
        },
      },
    });
  });

  const PORT = process.env.FRIGATE_MANAGER_PORT ?? 3100;
  app.listen(PORT, () => {
    console.log(`\n🚀 IA Cloud Vision — Frigate Manager running on http://localhost:${PORT}`);
    console.log('   Admin: http://localhost:' + PORT + '/frigate-manager/instances');
    console.log('   Proxy: http://localhost:' + PORT + '/api/frigate/* (needs x-tenant-id header)\n');
  });
}
