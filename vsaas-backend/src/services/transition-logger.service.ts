/**
 * transition-logger.service.ts — Box → Cloud transitions ingest
 *
 * Box envia array `transitions[]` no `/heartbeat` (payload com .passthrough).
 * Cada transition representa mudança de estado detectada Box-side:
 * tunnel caiu, câmera offline, disco crítico, license expirando, etc.
 *
 * Esta função persiste cada transition em `EdgeConnectionLog` para que o
 * painel `/admin/tenants/:id?tab=logs` mostre eventos reais da fleet.
 *
 * Mapeia severity Box-side → status EdgeConnectionLog:
 *   critical | _FAILED | _DOWN  → FAILED
 *   error                       → FAILED
 *   warning  | _DRIFT           → PENDING
 *   info     | _UP / _RECOVERED → SUCCESS
 *
 * Idempotência: best-effort. Se Box reenviar mesmas transitions
 * (após retry), inserções duplicadas são aceitas — analyst filtra
 * por timestamp se for o caso.
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

export interface BoxTransition {
  type:           string                   // ex: TUNNEL_DOWN, CAMERA_OFFLINE
  severity?:      'info' | 'warning' | 'error' | 'critical' | string
  ts?:            number                   // unix epoch (segundos OU ms — heurística abaixo)
  details?:       Record<string, unknown>  // payload livre Box
  correlationId?: string                   // gerado Box (UUID4 12-char)
}

/** Conjunto de tipos de transitions reconhecidos (catálogo Box).
 *  Tipos fora desta lista são aceitos (forward-compat) mas logados em DEBUG. */
const KNOWN_TRANSITIONS = new Set([
  'TUNNEL_DOWN', 'TUNNEL_UP',
  'CAMERA_OFFLINE', 'CAMERA_ONLINE', 'CAMERA_DEGRADED', 'CAMERA_RECOVERED',
  'DISK_LOW', 'DISK_CRITICAL', 'DISK_RECOVERED',
  'LICENSE_EXPIRING', 'LICENSE_EXPIRED',
  'BOX_REBOOT',
  'AI_DETECTOR_STALLED', 'AI_DETECTOR_RECOVERED',
  'TEMP_HIGH', 'TEMP_CRITICAL', 'TEMP_RECOVERED',
  'CONFIG_DRIFT',
  'VAULT_TOKEN_EXPIRING', 'VAULT_TOKEN_EXPIRED',
  'SRT_PUBLISH_FAILED', 'SRT_PUBLISH_RECOVERED',
  'FRIGATE_RESTART', 'FRIGATE_CRASH',
  'STORAGE_UPLOAD_FAILED', 'STORAGE_QUOTA_LOW',
  'LOCAL_LOGIN_OK', 'LOCAL_LOGIN_FAIL',
  'LOCAL_FACTORY_RESET', 'LOCAL_RESTORE_BACKUP',
])

function severityToStatus(t: BoxTransition): 'SUCCESS' | 'FAILED' | 'PENDING' {
  const sev  = (t.severity ?? '').toLowerCase()
  const type = (t.type ?? '').toUpperCase()

  // Critical/error/_FAILED/_DOWN/_CRITICAL/_EXPIRED → FAILED
  if (sev === 'critical' || sev === 'error') return 'FAILED'
  if (type.endsWith('_FAILED') || type.endsWith('_DOWN') ||
      type.endsWith('_CRITICAL') || type.endsWith('_EXPIRED') ||
      type === 'FRIGATE_CRASH' || type === 'LOCAL_LOGIN_FAIL') return 'FAILED'

  // Warning/_DRIFT/_LOW/_HIGH/_EXPIRING/_STALLED → PENDING
  if (sev === 'warning') return 'PENDING'
  if (type.endsWith('_DRIFT') || type.endsWith('_LOW') ||
      type.endsWith('_HIGH') || type.endsWith('_EXPIRING') ||
      type.endsWith('_STALLED') || type === 'CAMERA_DEGRADED') return 'PENDING'

  // Default → SUCCESS (UP, ONLINE, RECOVERED, REBOOT, OK, RESET, RESTORE, RESTART)
  return 'SUCCESS'
}

/** Heurística: ts pode vir em segundos (10 dígitos) ou ms (13 dígitos).
 *  Convertemos pra Date sempre. */
function tsToDate(ts?: number): Date {
  if (!ts || !Number.isFinite(ts)) return new Date()
  // Se ts > 10^12, é ms; senão segundos
  return new Date(ts > 1e12 ? ts : ts * 1000)
}

/**
 * Persiste lista de transitions em EdgeConnectionLog.
 * Best-effort: nunca lança — falha individual loga warn e continua.
 */
export async function logBoxTransitions(
  edgeNodeId: string,
  transitions: BoxTransition[] | undefined | null,
): Promise<{ ingested: number; skipped: number; unknownTypes: string[] }> {
  if (!Array.isArray(transitions) || transitions.length === 0) {
    return { ingested: 0, skipped: 0, unknownTypes: [] }
  }

  let ingested = 0
  let skipped = 0
  const unknownTypes: string[] = []

  for (const t of transitions) {
    if (!t || typeof t !== 'object' || typeof t.type !== 'string') {
      skipped++
      continue
    }

    const eventType = t.type.toUpperCase()
    if (!KNOWN_TRANSITIONS.has(eventType)) {
      unknownTypes.push(eventType)
      // Aceita mesmo assim (forward-compat) — Box pode evoluir o catálogo
    }

    const status   = severityToStatus(t)
    const createdAt = tsToDate(t.ts)

    try {
      await prisma.edgeConnectionLog.create({
        data: {
          edgeNodeId,
          eventType,
          status,
          payload: {
            ...(t.details ?? {}),
            severity:      t.severity ?? null,
            correlationId: t.correlationId ?? null,
            // Marca origem para distinguir de eventos gerados Cloud-side
            source:        'box_heartbeat_transition',
          } as any,
          createdAt,
        },
      })
      ingested++
    } catch (err: any) {
      logger.warn(
        { err: err.message, edgeNodeId, type: eventType },
        'box_transition_persist_failed',
      )
      skipped++
    }
  }

  if (unknownTypes.length > 0) {
    logger.debug(
      { edgeNodeId, unknownTypes: [...new Set(unknownTypes)] },
      'box_transition_unknown_types_received',
    )
  }

  return { ingested, skipped, unknownTypes: [...new Set(unknownTypes)] }
}
