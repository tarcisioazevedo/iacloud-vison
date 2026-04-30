// ============================================================
// IA Cloud Vision — Frigate Manager Types
// Multi-tenant instance management for VSaaS
// ============================================================

/** Status of a Frigate instance */
export type InstanceStatus = 'provisioning' | 'running' | 'stopped' | 'error' | 'destroying';

/** Deployment mode: cloud (server-managed) or edge (client-managed) */
export type DeploymentMode = 'cloud' | 'edge';

/** Frigate instance registered in the system */
export interface FrigateInstance {
  id: string;
  tenantId: string;
  tenantName: string;
  host: string;
  port: number;
  status: InstanceStatus;
  deploymentMode: DeploymentMode;
  containerId?: string;          // Docker container ID (cloud mode only)
  apiKey?: string;               // GenAI API key for this tenant
  maxCameras: number;            // License limit
  createdAt: Date;
  updatedAt: Date;
}

/** Camera registered to a Frigate instance */
export interface FrigateCamera {
  id: string;
  instanceId: string;
  cameraName: string;
  rtspUrl: string;
  detectEnabled: boolean;
  recordEnabled: boolean;
  lprEnabled: boolean;
  faceRecognitionEnabled: boolean;
  width: number;
  height: number;
  fps: number;
}

/** Input for registering a new instance */
export interface RegisterInstanceInput {
  tenantId: string;
  tenantName: string;
  host: string;
  port: number;
  deploymentMode: DeploymentMode;
  apiKey?: string;
  maxCameras?: number;
}

/** Input for provisioning a new instance via Docker (Option 2) */
export interface ProvisionInstanceInput {
  tenantId: string;
  tenantName: string;
  cameras: CameraInput[];
  apiKey?: string;
  maxCameras?: number;
}

/** Camera input for config generation */
export interface CameraInput {
  name: string;
  rtspUrl: string;
  detectWidth?: number;
  detectHeight?: number;
  detectFps?: number;
  recordEnabled?: boolean;
  lprEnabled?: boolean;
  faceRecognitionEnabled?: boolean;
}

/** Health status of a Frigate instance */
export interface InstanceHealth {
  tenantId: string;
  status: InstanceStatus;
  uptime?: number;               // seconds
  cameras: CameraHealth[];
  detectorInferenceMs?: number;
  cpuPercent?: number;
  memPercent?: number;
  gpuPercent?: number;
  storageUsedBytes?: number;
  storageTotalBytes?: number;
}

/** Camera health from /api/stats */
export interface CameraHealth {
  name: string;
  cameraFps: number;
  detectionFps: number;
  processedFps: number;
  skippedFps: number;
  detectionEnabled: boolean;
}

/** Proxy target resolved from tenant context */
export interface ProxyTarget {
  tenantId: string;
  baseUrl: string;               // e.g. "http://10.0.0.5:5001"
}

/** Configuration for the Frigate Manager module */
export interface FrigateManagerConfig {
  /** PostgreSQL connection string */
  databaseUrl: string;
  /** Default GenAI API key (fallback if tenant doesn't have one) */
  defaultGenaiApiKey?: string;
  /** Default GenAI model */
  defaultGenaiModel?: string;
  /** Docker socket path for auto-provisioning */
  dockerSocket?: string;
  /** Base port for auto-provisioned instances (incremented per tenant) */
  basePort?: number;
  /** Network name for Docker containers */
  dockerNetwork?: string;
  /** Frigate Docker image to use */
  frigateImage?: string;
  /** Base path for tenant storage volumes */
  storageBasePath?: string;
}
