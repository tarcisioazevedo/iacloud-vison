/**
 * detect-stale-edge.ts — FCB-002
 *
 * A cada N minutos varre EdgeNodes ONLINE/DEGRADED com lastHeartbeat antigo
 * e dispara transição de estado + notificação ao integrador responsável.
 *
 * Critérios (configuráveis via env):
 *   STALE_EDGE_DEGRADE_AFTER_MIN=15  → ONLINE → DEGRADED  (warning)
 *   STALE_EDGE_OFFLINE_AFTER_MIN=30  → DEGRADED → OFFLINE (alerta)
 *   STALE_EDGE_CHECK_INTERVAL_SEC=300 (5 min)
 *
 * Persiste evento em EdgeConnectionLog e dispara notificação via
 * AlertRecipient do integrador (e-mail/WhatsApp via Evolution).
 *
 * Idempotência: se Box já está OFFLINE, não dispara alerta de novo
 * (verifica EdgeConnectionLog do último ciclo).
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { dispatchAlert } from '../lib/notification-dispatcher'

const DEGRADE_AFTER_MIN  = Number(process.env.STALE_EDGE_DEGRADE_AFTER_MIN ?? 15)
const OFFLINE_AFTER_MIN  = Number(process.env.STALE_EDGE_OFFLINE_AFTER_MIN ?? 30)
const CHECK_INTERVAL_SEC = Number(process.env.STALE_EDGE_CHECK_INTERVAL_SEC ?? 300)

interface StaleResult {
  totalChecked:   number
  degraded:       number
  wentOffline:    number
  alertsSent:     number
  alertsFailed:   number
}

export async function runStaleEdgeDetection(): Promise<StaleResult> {
  const now = Date.now()
  const degradeAt = new Date(now - DEGRADE_AFTER_MIN * 60_000)
  const offlineAt = new Date(now - OFFLINE_AFTER_MIN * 60_000)

  // 1) ONLINE com heartbeat < degradeAt → DEGRADED (warning)
  const toDegrade = await prisma.edgeNode.findMany({
    where: {
      status: 'ONLINE',
      OR: [
        { lastHeartbeat: { lt: degradeAt } },
        { lastHeartbeat: null },
      ],
    },
    select: {
      id: true, name: true, serialNumber: true, lastHeartbeat: true,
      site: {
        select: {
          id: true, name: true,
          clienteFinal: { select: { integradorId: true, name: true } },
        },
      },
    },
  })

  // 2) DEGRADED com heartbeat < offlineAt → OFFLINE (alerta crítico)
  const toOffline = await prisma.edgeNode.findMany({
    where: {
      status: 'DEGRADED',
      OR: [
        { lastHeartbeat: { lt: offlineAt } },
        { lastHeartbeat: null },
      ],
    },
    select: {
      id: true, name: true, serialNumber: true, lastHeartbeat: true,
      site: {
        select: {
          id: true, name: true,
          clienteFinal: { select: { integradorId: true, name: true } },
        },
      },
    },
  })

  let alertsSent = 0
  let alertsFailed = 0

  // Aplica DEGRADED + warning
  for (const n of toDegrade) {
    await prisma.edgeNode.update({
      where: { id: n.id },
      data:  { status: 'DEGRADED' as any },
    }).catch(err => logger.warn({ err: err.message, edgeNodeId: n.id }, 'stale_edge_degrade_update_failed'))

    await prisma.edgeConnectionLog?.create({
      data: {
        edgeNodeId:   n.id,
        eventType:    'STALE_HEARTBEAT_DETECTED',
        status:       'WARN',
        errorCode:    'DEGRADED',
        errorMessage: `Sem heartbeat há ${formatAge(n.lastHeartbeat, now)} — transição ONLINE → DEGRADED`,
        payload: {
          minutesSinceLastHB: minutesSince(n.lastHeartbeat, now),
          threshold: DEGRADE_AFTER_MIN,
        } as any,
      },
    }).catch(() => {/* não bloqueia */})

    const integradorId = n.site?.clienteFinal?.integradorId
    if (integradorId) {
      try {
        await dispatchAlert({
          integradorId,
          severity: 'WARNING',
          title:    `[Atenção] Box "${n.name}" sem comunicação`,
          body:     `A Box ${n.name} (Site ${n.site?.name ?? '—'}) está sem heartbeat há ${formatAge(n.lastHeartbeat, now)}. Status alterado para DEGRADED. Aguardando ${OFFLINE_AFTER_MIN - DEGRADE_AFTER_MIN}min antes de marcar OFFLINE.`,
        })
        alertsSent++
      } catch (err: any) {
        alertsFailed++
        logger.warn({ err: err.message, edgeNodeId: n.id }, 'stale_edge_alert_dispatch_failed')
      }
    }
  }

  // Aplica OFFLINE + alerta crítico
  for (const n of toOffline) {
    await prisma.edgeNode.update({
      where: { id: n.id },
      data:  { status: 'OFFLINE' as any },
    }).catch(err => logger.warn({ err: err.message, edgeNodeId: n.id }, 'stale_edge_offline_update_failed'))

    await prisma.edgeConnectionLog?.create({
      data: {
        edgeNodeId:   n.id,
        eventType:    'BOX_OFFLINE',
        status:       'ERROR',
        errorCode:    'OFFLINE',
        errorMessage: `Sem heartbeat há ${formatAge(n.lastHeartbeat, now)} — transição DEGRADED → OFFLINE`,
        payload: {
          minutesSinceLastHB: minutesSince(n.lastHeartbeat, now),
          threshold: OFFLINE_AFTER_MIN,
        } as any,
      },
    }).catch(() => {/* não bloqueia */})

    const integradorId = n.site?.clienteFinal?.integradorId
    if (integradorId) {
      try {
        await dispatchAlert({
          integradorId,
          severity: 'CRITICAL',
          title:    `[CRÍTICO] Box "${n.name}" OFFLINE`,
          body:     `A Box ${n.name} (Site ${n.site?.name ?? '—'}, Cliente ${n.site?.clienteFinal?.name ?? '—'}) está OFFLINE há ${formatAge(n.lastHeartbeat, now)}. Câmeras provavelmente sem gravação. Investigar com urgência: rede do cliente, energia, hardware.`,
        })
        alertsSent++
      } catch (err: any) {
        alertsFailed++
        logger.warn({ err: err.message, edgeNodeId: n.id }, 'stale_edge_alert_dispatch_failed')
      }
    }
  }

  const result: StaleResult = {
    totalChecked: toDegrade.length + toOffline.length,
    degraded:     toDegrade.length,
    wentOffline:  toOffline.length,
    alertsSent,
    alertsFailed,
  }

  if (result.totalChecked > 0) {
    logger.info(result, 'stale_edge_detection_run')
  } else {
    logger.debug(result, 'stale_edge_detection_run_clean')
  }

  return result
}

function minutesSince(date: Date | null | undefined, nowMs: number): number {
  if (!date) return Infinity
  return Math.floor((nowMs - date.getTime()) / 60_000)
}

function formatAge(date: Date | null | undefined, nowMs: number): string {
  if (!date) return 'nunca'
  const min = minutesSince(date, nowMs)
  if (min === Infinity) return 'nunca'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ${min % 60}min`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

let timer: NodeJS.Timeout | null = null

/** Inicia o cron interno (chamado em scheduleJobs() do index.ts) */
export function startStaleEdgeDetectionJob(): void {
  if (timer) return
  logger.info(
    { intervalSec: CHECK_INTERVAL_SEC, degradeAfterMin: DEGRADE_AFTER_MIN, offlineAfterMin: OFFLINE_AFTER_MIN },
    'stale_edge_detection_started',
  )
  // Roda imediato (smoke test do startup) + intervalo
  runStaleEdgeDetection().catch(err => logger.error({ err: err.message }, 'stale_edge_detection_startup_failed'))
  timer = setInterval(() => {
    runStaleEdgeDetection().catch(err => logger.error({ err: err.message }, 'stale_edge_detection_run_failed'))
  }, CHECK_INTERVAL_SEC * 1000)
}

export function stopStaleEdgeDetectionJob(): void {
  if (timer) { clearInterval(timer); timer = null }
}
