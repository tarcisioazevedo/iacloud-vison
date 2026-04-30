// ============================================================
// IA Cloud Vision — Admin Routes
// Management endpoints for Frigate instances
// ============================================================

import { Router, Request, Response } from 'express';
import {
  registerInstance,
  removeInstance,
  listInstances,
  checkInstanceHealth,
  checkAllInstancesHealth,
} from '../services/instance-registry';
import { generateFrigateConfig } from '../services/config-generator';
import { RegisterInstanceInput, CameraInput } from '../types';

export const adminRouter = Router();

/**
 * POST /frigate-manager/instances
 * Register a new Frigate instance (manual — Option 1)
 */
adminRouter.post('/instances', (req: Request, res: Response) => {
  try {
    const input: RegisterInstanceInput = req.body;

    if (!input.tenantId || !input.tenantName || !input.host || !input.port) {
      res.status(400).json({
        error: 'Missing required fields: tenantId, tenantName, host, port',
      });
      return;
    }

    const instance = registerInstance(input);
    res.status(201).json(instance);
  } catch (err: any) {
    res.status(409).json({ error: err.message });
  }
});

/**
 * GET /frigate-manager/instances
 * List all registered Frigate instances
 */
adminRouter.get('/instances', (_req: Request, res: Response) => {
  const instances = listInstances();
  res.json({
    total: instances.length,
    instances,
  });
});

/**
 * DELETE /frigate-manager/instances/:tenantId
 * Remove a Frigate instance registration
 */
adminRouter.delete('/instances/:tenantId', (req: Request, res: Response) => {
  const removed = removeInstance(req.params.tenantId);
  if (removed) {
    res.json({ message: 'Instance removed successfully' });
  } else {
    res.status(404).json({ error: 'Instance not found' });
  }
});

/**
 * GET /frigate-manager/instances/:tenantId/health
 * Health check for a specific tenant's Frigate instance
 */
adminRouter.get('/instances/:tenantId/health', async (req: Request, res: Response) => {
  const health = await checkInstanceHealth(req.params.tenantId);
  if (health) {
    res.json(health);
  } else {
    res.status(404).json({ error: 'Instance not found or not reachable' });
  }
});

/**
 * GET /frigate-manager/health
 * Health check for ALL registered instances
 */
adminRouter.get('/health', async (_req: Request, res: Response) => {
  const allHealth = await checkAllInstancesHealth();
  const running = allHealth.filter(h => h.status === 'running').length;
  const errored = allHealth.filter(h => h.status === 'error').length;

  res.json({
    summary: { total: allHealth.length, running, errored },
    instances: allHealth,
  });
});

/**
 * POST /frigate-manager/generate-config
 * Generate a Frigate config.yml preview for a tenant (does not persist)
 */
adminRouter.post('/generate-config', (req: Request, res: Response) => {
  const { tenantName, cameras, apiKey } = req.body as {
    tenantName: string;
    cameras: CameraInput[];
    apiKey?: string;
  };

  if (!tenantName || !cameras || cameras.length === 0) {
    res.status(400).json({ error: 'Missing tenantName or cameras array' });
    return;
  }

  const configYaml = generateFrigateConfig({
    tenantName,
    cameras,
    genaiApiKey: apiKey,
  });

  res.setHeader('Content-Type', 'text/yaml');
  res.send(configYaml);
});
