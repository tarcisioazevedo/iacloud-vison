// ============================================================
// IA Cloud Vision — Instance Registry Service
// CRUD operations for Frigate instances in PostgreSQL
// ============================================================

import {
  FrigateInstance,
  RegisterInstanceInput,
  InstanceStatus,
  InstanceHealth,
  CameraHealth,
} from '../types';

/**
 * In-memory store for Opção 1 (fast start).
 * Replace with Prisma/PostgreSQL when integrating with the VSaaS backend.
 */
const instances: Map<string, FrigateInstance> = new Map();

// ── CRUD Operations ────────────────────────────────────────

/** Register a new Frigate instance for a tenant */
export function registerInstance(input: RegisterInstanceInput): FrigateInstance {
  if (instances.has(input.tenantId)) {
    throw new Error(`Instance already exists for tenant ${input.tenantId}`);
  }

  const instance: FrigateInstance = {
    id: `fri_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tenantId: input.tenantId,
    tenantName: input.tenantName,
    host: input.host,
    port: input.port,
    status: 'running',
    deploymentMode: input.deploymentMode,
    apiKey: input.apiKey,
    maxCameras: input.maxCameras ?? 16,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  instances.set(input.tenantId, instance);
  console.log(`[FrigateManager] Registered instance for tenant "${input.tenantName}" at ${input.host}:${input.port}`);
  return instance;
}

/** Remove a Frigate instance for a tenant */
export function removeInstance(tenantId: string): boolean {
  const existed = instances.delete(tenantId);
  if (existed) {
    console.log(`[FrigateManager] Removed instance for tenant ${tenantId}`);
  }
  return existed;
}

/** Get the Frigate instance for a specific tenant */
export function getInstanceByTenantId(tenantId: string): FrigateInstance | undefined {
  return instances.get(tenantId);
}

/** List all registered Frigate instances */
export function listInstances(): FrigateInstance[] {
  return Array.from(instances.values());
}

/** Update the status of an instance */
export function updateInstanceStatus(tenantId: string, status: InstanceStatus): boolean {
  const instance = instances.get(tenantId);
  if (!instance) return false;
  instance.status = status;
  instance.updatedAt = new Date();
  return true;
}

/** Get the base URL for a tenant's Frigate instance */
export function getBaseUrl(tenantId: string): string | null {
  const instance = instances.get(tenantId);
  if (!instance || instance.status !== 'running') return null;
  return `http://${instance.host}:${instance.port}`;
}

// ── Health Check ───────────────────────────────────────────

/** Check health of a specific Frigate instance by querying its /api/stats endpoint */
export async function checkInstanceHealth(tenantId: string): Promise<InstanceHealth | null> {
  const baseUrl = getBaseUrl(tenantId);
  if (!baseUrl) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${baseUrl}/api/stats`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      updateInstanceStatus(tenantId, 'error');
      return { tenantId, status: 'error', cameras: [] };
    }

    const stats = await response.json() as Record<string, any>;

    // Parse camera stats
    const cameras: CameraHealth[] = [];
    if (stats.cameras) {
      for (const [name, cam] of Object.entries(stats.cameras as Record<string, any>)) {
        cameras.push({
          name,
          cameraFps: cam.camera_fps ?? 0,
          detectionFps: cam.detection_fps ?? 0,
          processedFps: cam.process_fps ?? 0,
          skippedFps: cam.skipped_fps ?? 0,
          detectionEnabled: cam.detection_enabled ?? false,
        });
      }
    }

    // Parse detector stats
    let inferenceMs: number | undefined;
    if (stats.detectors) {
      const detectorValues = Object.values(stats.detectors as Record<string, any>);
      if (detectorValues.length > 0) {
        inferenceMs = (detectorValues[0] as any).inference_speed ?? undefined;
      }
    }

    // Parse CPU usage
    let cpuPercent: number | undefined;
    if (stats.cpu_usages) {
      const cpuValues = Object.values(stats.cpu_usages as Record<string, any>);
      const total = cpuValues.reduce((sum: number, v: any) => sum + (v.cpu ?? 0), 0);
      cpuPercent = total;
    }

    updateInstanceStatus(tenantId, 'running');

    return {
      tenantId,
      status: 'running',
      uptime: stats.uptime ?? undefined,
      cameras,
      detectorInferenceMs: inferenceMs,
      cpuPercent,
      storageUsedBytes: stats.storage?.['/media/frigate']?.used ?? undefined,
      storageTotalBytes: stats.storage?.['/media/frigate']?.total ?? undefined,
    };
  } catch (err) {
    updateInstanceStatus(tenantId, 'error');
    return { tenantId, status: 'error', cameras: [] };
  }
}

/** Check health of all registered instances */
export async function checkAllInstancesHealth(): Promise<InstanceHealth[]> {
  const results: InstanceHealth[] = [];
  for (const instance of instances.values()) {
    const health = await checkInstanceHealth(instance.tenantId);
    if (health) results.push(health);
  }
  return results;
}
