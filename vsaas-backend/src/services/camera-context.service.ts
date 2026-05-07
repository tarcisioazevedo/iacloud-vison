/**
 * Camera Context Service — resolve a hierarquia humana de uma câmera.
 *
 * Por que existe:
 *   `CameraLog`, `RecordingSegment` e alertas só armazenam IDs (UUIDs).
 *   Pra que dashboard, logs persistidos e mensagens de alerta tenham
 *   sentido sem JOIN, denormalizamos a hierarquia: `cameraName`,
 *   `siteName`, `clienteFinalName`, `integradorName`.
 *
 * Onde usar:
 *   - `recording-ingest.service` → grava em `CameraLog.detailsJson`
 *   - `recording-no-upload-watchdog` → injeta no payload do alerta
 *   - Endpoint `/recordings/upload-logs` → resposta JSON enriquecida
 *
 * Performance:
 *   Cache em memória 5min (TTL configurável). Câmeras + site + cliente
 *   raramente mudam — cache hit > 99% em hot path. Invalidação acontece
 *   só na expiração; qualquer rename só vai aparecer após 5min.
 */
import { prisma } from '../lib/prisma'

const TTL_MS = Number(process.env.CAMERA_CONTEXT_TTL_MS ?? 5 * 60 * 1000)

export interface CameraContext {
  cameraId:           string
  cameraName:         string
  siteId:             string | null
  siteName:           string | null
  clienteFinalId:     string | null
  clienteFinalName:   string | null
  integradorId:       string | null
  integradorName:     string | null
  edgeNodeId:         string | null
  edgeNodeSerial:     string | null
}

interface CacheEntry {
  ctx: CameraContext
  expiresAt: number
}
const cache = new Map<string, CacheEntry>()

/**
 * Resolve hierarquia completa de uma câmera. Retorna `null` se câmera
 * não existir. Caso encontre câmera mas algum nível acima estiver vazio
 * (raro), os campos correspondentes ficam `null`.
 */
export async function getCameraContext(cameraId: string): Promise<CameraContext | null> {
  const hit = cache.get(cameraId)
  if (hit && hit.expiresAt > Date.now()) return hit.ctx

  const cam = await prisma.camera.findUnique({
    where: { id: cameraId },
    select: {
      id: true,
      name: true,
      siteId: true,
      edgeNodeId: true,
      edgeNode: { select: { serialNumber: true } },
      site: {
        select: {
          id: true, name: true,
          clienteFinal: {
            select: {
              id: true, name: true,
              integrador: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  })

  if (!cam) return null

  const ctx: CameraContext = {
    cameraId:         cam.id,
    cameraName:       cam.name,
    siteId:           cam.siteId,
    siteName:         cam.site?.name ?? null,
    clienteFinalId:   cam.site?.clienteFinal?.id ?? null,
    clienteFinalName: cam.site?.clienteFinal?.name ?? null,
    integradorId:     cam.site?.clienteFinal?.integrador?.id ?? null,
    integradorName:   cam.site?.clienteFinal?.integrador?.name ?? null,
    edgeNodeId:       cam.edgeNodeId,
    edgeNodeSerial:   cam.edgeNode?.serialNumber ?? null,
  }
  cache.set(cameraId, { ctx, expiresAt: Date.now() + TTL_MS })
  return ctx
}

/** Invalida o cache de uma câmera (chamar após rename/relocate). */
export function invalidateCameraContext(cameraId: string): void {
  cache.delete(cameraId)
}

/** Pra debug. */
export function _cameraContextCacheSize(): number {
  return cache.size
}
