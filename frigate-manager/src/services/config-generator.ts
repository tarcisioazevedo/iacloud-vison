// ============================================================
// IA Cloud Vision — Config Generator Service
// Generates Frigate config.yml dynamically per tenant
// ============================================================

import * as yaml from 'js-yaml';
import { CameraInput } from '../types';

interface ConfigOptions {
  tenantName: string;
  cameras: CameraInput[];
  genaiApiKey?: string;
  genaiModel?: string;
  mqttHost?: string;
  mqttPort?: number;
  storagePath?: string;
}

/**
 * Generates a complete Frigate config.yml for a tenant.
 * Includes optimized defaults for: detection, recording, LPR,
 * face recognition, GenAI descriptions, and semantic search.
 */
export function generateFrigateConfig(options: ConfigOptions): string {
  const {
    tenantName,
    cameras,
    genaiApiKey,
    genaiModel = 'gemini-2.5-pro-preview-05-06',
    mqttHost = 'mqtt',
    mqttPort = 1883,
    storagePath = '/media/frigate',
  } = options;

  // Build camera configurations
  const camerasConfig: Record<string, any> = {};

  for (const cam of cameras) {
    const cameraConfig: Record<string, any> = {
      enabled: true,
      ffmpeg: {
        inputs: [
          {
            path: cam.rtspUrl,
            input_args: 'preset-rtsp-restream',
            roles: ['detect', 'record'],
          },
        ],
      },
      detect: {
        enabled: cam.detectWidth ? true : true,
        width: cam.detectWidth ?? 1280,
        height: cam.detectHeight ?? 720,
        fps: cam.detectFps ?? 5,
      },
      record: {
        enabled: cam.recordEnabled ?? true,
        retain: {
          days: 7,
          mode: 'motion',
        },
        events: {
          retain: {
            default: 14,
            mode: 'active_objects',
          },
        },
      },
      snapshots: {
        enabled: true,
        retain: { default: 14 },
      },
      objects: {
        track: ['person', 'car', 'motorcycle', 'bus', 'truck', 'dog', 'cat'],
      },
    };

    // Per-camera LPR toggle
    if (cam.lprEnabled === false) {
      cameraConfig.lpr = { enabled: false };
    }

    // Per-camera face recognition toggle
    if (cam.faceRecognitionEnabled === false) {
      cameraConfig.face_recognition = { enabled: false };
    }

    camerasConfig[cam.name] = cameraConfig;
  }

  // Build complete config
  const config: Record<string, any> = {
    mqtt: {
      enabled: true,
      host: mqttHost,
      port: mqttPort,
      topic_prefix: `frigate/${tenantName.toLowerCase().replace(/\s+/g, '_')}`,
    },

    detectors: {
      cpu1: {
        type: 'cpu',
        num_threads: 2,
      },
    },

    // Global LPR — Mercosul plates (Brazil)
    lpr: {
      enabled: true,
      model_size: 'small',
      min_plate_length: 7,
      format: '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$',
    },

    // Global Face Recognition
    face_recognition: {
      enabled: true,
      model_size: 'small',
      min_faces: 1,
      recognition_threshold: 0.85,
    },

    // Semantic Search (embeddings for natural language queries)
    semantic_search: {
      enabled: true,
      reindex: false,
    },

    // Recording defaults
    record: {
      enabled: true,
      retain: {
        days: 7,
        mode: 'motion',
      },
      events: {
        retain: {
          default: 14,
          mode: 'active_objects',
        },
      },
    },

    // Snapshots defaults
    snapshots: {
      enabled: true,
      retain: { default: 14 },
    },

    // Birdseye (multi-camera overview)
    birdseye: {
      enabled: true,
      mode: 'objects',
    },

    cameras: camerasConfig,
  };

  // GenAI configuration (Gemini for scene descriptions)
  if (genaiApiKey) {
    config.genai = {
      enabled: true,
      provider: 'google',
      model: genaiModel,
      api_key: genaiApiKey,
      object_prompts: {
        person: 'Descreva detalhadamente esta pessoa detectada pela câmera de segurança. Inclua: aparência física, vestimenta, objetos que carrega, direção do movimento e qualquer comportamento relevante. Responda em Português do Brasil.',
        car: 'Descreva este veículo detectado pela câmera de segurança. Inclua: tipo (sedã, SUV, pickup), cor, marca/modelo se visível, placa se legível, e direção do movimento. Responda em Português do Brasil.',
      },
    };
  }

  return yaml.dump(config, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
  });
}

/**
 * Generates a minimal go2rtc config for the tenant's cameras
 */
export function generateGo2rtcConfig(cameras: CameraInput[]): string {
  const streams: Record<string, string> = {};

  for (const cam of cameras) {
    streams[cam.name] = cam.rtspUrl;
  }

  const config = { streams };

  return yaml.dump(config, { indent: 2, lineWidth: 120 });
}
