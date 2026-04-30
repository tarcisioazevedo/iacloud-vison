// ============================================================
// IA Cloud Vision — Docker Provisioner Service
// Auto-provisioning of Frigate containers (Option 2)
// ============================================================
//
// STATUS: Stub/Interface ready. Full implementation pending.
// This module will use `dockerode` to create/destroy Frigate
// containers automatically when a tenant is onboarded.
//

import { ProvisionInstanceInput, FrigateInstance } from '../types';
import { generateFrigateConfig, generateGo2rtcConfig } from './config-generator';
import { registerInstance } from './instance-registry';

interface DockerProvisionerConfig {
  /** Docker socket path (default: /var/run/docker.sock) */
  socketPath: string;
  /** Frigate Docker image (default: ghcr.io/blakeblackshear/frigate:stable) */
  frigateImage: string;
  /** Base port for auto-assigned ports (default: 5100) */
  basePort: number;
  /** Docker network name (default: icv-network) */
  networkName: string;
  /** Host path for tenant storage volumes */
  storageBasePath: string;
  /** MQTT broker host accessible from Docker network */
  mqttHost: string;
}

const DEFAULT_CONFIG: DockerProvisionerConfig = {
  socketPath: '/var/run/docker.sock',
  frigateImage: 'ghcr.io/blakeblackshear/frigate:stable',
  basePort: 5100,
  networkName: 'icv-network',
  storageBasePath: '/opt/icv/tenants',
  mqttHost: 'mqtt',
};

/** Port counter for auto-assignment */
let nextPort = DEFAULT_CONFIG.basePort;

/**
 * Provision a new Frigate container for a tenant.
 *
 * TODO: Implement with dockerode when ready for Option 2.
 * For now, this generates the config and registers the instance,
 * but expects the container to be created manually.
 */
export async function provisionInstance(
  input: ProvisionInstanceInput,
  config: Partial<DockerProvisionerConfig> = {}
): Promise<FrigateInstance> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const assignedPort = nextPort++;

  // Generate the configs that would be mounted into the container
  const frigateYaml = generateFrigateConfig({
    tenantName: input.tenantName,
    cameras: input.cameras,
    genaiApiKey: input.apiKey,
    mqttHost: cfg.mqttHost,
  });

  const go2rtcYaml = generateGo2rtcConfig(input.cameras);

  console.log(`[DockerProvisioner] Generated config for tenant "${input.tenantName}":`);
  console.log(`  Port: ${assignedPort}`);
  console.log(`  Cameras: ${input.cameras.length}`);
  console.log(`  Storage: ${cfg.storageBasePath}/${input.tenantId}/`);
  console.log('--- config.yml ---');
  console.log(frigateYaml);

  // ────────────────────────────────────────────────────────
  // TODO (Option 2): Replace with actual Docker container creation
  //
  // const Docker = require('dockerode');
  // const docker = new Docker({ socketPath: cfg.socketPath });
  //
  // const container = await docker.createContainer({
  //   Image: cfg.frigateImage,
  //   name: `icv-frigate-${input.tenantId}`,
  //   Env: [
  //     `FRIGATE_GENAI_API_KEY=${input.apiKey ?? ''}`,
  //   ],
  //   HostConfig: {
  //     PortBindings: {
  //       '5000/tcp': [{ HostPort: String(assignedPort) }],
  //       '8554/tcp': [{ HostPort: String(assignedPort + 1000) }],
  //       '8555/tcp': [{ HostPort: String(assignedPort + 2000) }],
  //     },
  //     Binds: [
  //       `${cfg.storageBasePath}/${input.tenantId}/config:/config`,
  //       `${cfg.storageBasePath}/${input.tenantId}/media:/media/frigate`,
  //     ],
  //     ShmSize: 256 * 1024 * 1024, // 256MB
  //     NetworkMode: cfg.networkName,
  //   },
  // });
  //
  // await container.start();
  // const containerInfo = await container.inspect();
  // ────────────────────────────────────────────────────────

  // Register the instance (manual for now)
  const instance = registerInstance({
    tenantId: input.tenantId,
    tenantName: input.tenantName,
    host: 'localhost',
    port: assignedPort,
    deploymentMode: 'cloud',
    apiKey: input.apiKey,
    maxCameras: input.maxCameras,
  });

  return instance;
}

/**
 * Destroy a Frigate container for a tenant.
 *
 * TODO: Implement with dockerode when ready for Option 2.
 */
export async function destroyInstance(tenantId: string): Promise<boolean> {
  console.log(`[DockerProvisioner] TODO: Destroy container for tenant ${tenantId}`);
  // TODO (Option 2):
  // const docker = new Docker({ socketPath: cfg.socketPath });
  // const container = docker.getContainer(`icv-frigate-${tenantId}`);
  // await container.stop();
  // await container.remove({ v: true });
  // Clean up storage volume
  return true;
}
