/**
 * LPR Service — lógica core de ingest de leitura de placa.
 *
 * Extraída do handler /plates/events/ingest para reuso. Hoje é chamada por:
 *  1. /plates/events/ingest  (edge-agent já existente)
 *  2. /detections/specialist-event  (worker detecta placa via Roboflow + Gemini readPlate)
 *
 * Faz: normaliza placa → match aproximado com LicensePlate cadastradas →
 * cria LicensePlateEvent → dispara alerta via NotificationChannel quando
 * placa cadastrada tiver alertOnMatch=true.
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { dispatchAlert } from '../lib/notification-dispatcher'
import { cameraLogService } from './camera-log.service'

export function normalizePlate(p: string): string {
  return p.replace(/[^A-Z0-9]/gi, '').toUpperCase()
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1])
    }
  }
  return dp[m][n]
}

export interface PlateIngestInput {
  cameraId:     string
  detectedPlate: string
  ocrScore:     number
  vehicleType?: string | null
  vehicleColor?: string | null
  direction?:   'IN' | 'OUT' | null
  capturedAt:   Date
  bbox?:        Record<string, number> | null
  cropGcsKey?:  string | null
  frameGcsKey?: string | null
}

export interface PlateIngestResult {
  event:    { id: string; detectedPlate: string; capturedAt: Date }
  matched:  { id: string; distance: number; category: string; label?: string | null } | null
}

/**
 * Ingest core. Idempotência: não — chame quando tiver certeza que é leitura nova.
 */
export async function processPlateRead(input: PlateIngestInput): Promise<PlateIngestResult | null> {
  const plate = normalizePlate(input.detectedPlate)
  if (plate.length < 4 || plate.length > 12) return null

  const camera = await prisma.camera.findUnique({
    where: { id: input.cameraId },
    select: {
      lprMatchDistance: true,
      name: true,
      site: {
        select: {
          clienteFinalId: true,
          clienteFinal: { select: { id: true, integradorId: true, name: true } },
        },
      },
    },
  })
  if (!camera) return null

  // Match aproximado contra LicensePlate cadastradas do cliente
  const maxDist = camera.lprMatchDistance ?? 1
  const known = await prisma.licensePlate.findMany({
    where: { clienteFinalId: camera.site.clienteFinalId, active: true },
    select: { id: true, plate: true, alertOnMatch: true, category: true, label: true },
  })
  let best: { id: string; distance: number; category: string; alertOnMatch: boolean; label: string | null } | null = null
  for (const kp of known) {
    const d = levenshtein(kp.plate, plate)
    if (d <= maxDist && (!best || d < best.distance)) {
      best = {
        id: kp.id, distance: d, category: kp.category,
        alertOnMatch: kp.alertOnMatch, label: kp.label,
      }
    }
  }

  const ev = await prisma.licensePlateEvent.create({
    data: {
      cameraId:       input.cameraId,
      licensePlateId: best?.id ?? null,
      detectedPlate:  plate,
      matchDistance:  best?.distance ?? null,
      ocrScore:       input.ocrScore,
      vehicleType:    input.vehicleType ?? null,
      vehicleColor:   input.vehicleColor ?? null,
      direction:      input.direction ?? null,
      capturedAt:     input.capturedAt,
      bboxJson:       input.bbox as any ?? undefined,
      cropGcsKey:     input.cropGcsKey ?? null,
      frameGcsKey:    input.frameGcsKey ?? null,
    },
  })

  await cameraLogService.logCamera({
    cameraId: input.cameraId,
    level:    best?.category === 'BLACKLIST' ? 'ERROR' : 'INFO',
    source:   'LPR',
    message:  best
      ? `LPR match: ${plate} → ${best.category} (dist=${best.distance})`
      : `LPR unknown plate: ${plate} (ocr=${input.ocrScore.toFixed(2)})`,
    details:  { plate, direction: input.direction, ocrScore: input.ocrScore },
    eventId:  ev.id,
  }).catch(() => {})

  // Dispara alerta multi-canal se cadastrada com alertOnMatch
  if (best?.alertOnMatch && camera.site.clienteFinal) {
    const isBlacklist = best.category === 'BLACKLIST'
    const severity: 'INFO' | 'WARNING' | 'CRITICAL' = isBlacklist ? 'CRITICAL' : 'INFO'
    const titlePrefix = isBlacklist ? '🚨 PLACA SUSPEITA DETECTADA' : '🚗 Placa reconhecida'
    dispatchAlert({
      integradorId:   camera.site.clienteFinal.integradorId,
      clienteFinalId: camera.site.clienteFinal.id,
      title:          `${titlePrefix} — ${plate}`,
      body:           `${best.label ?? plate} (${best.category})${input.direction ? ` • ${input.direction}` : ''}`,
      cameraName:     camera.name,
      severity,
      eventId:        ev.id,
    }).catch(err => logger.warn({ err: err.message }, 'lpr_dispatch_alert_failed'))
  }

  return {
    event: { id: ev.id, detectedPlate: plate, capturedAt: ev.capturedAt },
    matched: best ? {
      id: best.id, distance: best.distance, category: best.category, label: best.label,
    } : null,
  }
}
