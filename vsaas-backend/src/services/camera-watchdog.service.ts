/**
 * camera-watchdog.service.ts — Monitor de status de câmeras.
 *
 * Tick a cada 60 segundos:
 *   1. Busca câmeras ativas que não estão em MAINTENANCE
 *   2. Câmeras sem heartbeat por > offlineGraceSec → status ERROR + alerta
 *   3. Câmeras que voltaram (status ERA ERROR, agora tem heartbeat) → alerta CAMERA_UP
 *
 * Integra com alert.service.ts para deduplicação e envio de e-mail.
 * Integra com ingest.service.ts: usa Camera.lastOnlineAt (atualizado pelo go2rtc sync).
 */

import { prisma }         from '../lib/prisma'
import { logger }         from '../lib/logger'
import { alertService }   from './alert.service'

const TICK_MS          = 60_000   // 1 minuto
const DEFAULT_GRACE_SEC = 120      // 2 min antes de declarar offline

let timer: NodeJS.Timeout | null = null
let running = false

// ── Tick principal ────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  if (running) return
  running = true
  try {
    await checkCameras()
  } catch (err: any) {
    logger.warn({ err: err.message }, 'watchdog_tick_error')
  } finally {
    running = false
  }
}

async function checkCameras(): Promise<void> {
  const now = new Date()

  // Busca câmeras ativas (não em manutenção)
  const cameras = await prisma.camera.findMany({
    where:  { active: true, status: { not: 'MAINTENANCE' } },
    select: {
      id: true, name: true, status: true,
      location: true, lastOnlineAt: true,
      alertSuppressUntil: true,
      notificationCooldownSec: true,
      site: {
        select: {
          name: true,
          clienteFinalId: true,
          clienteFinal: { select: { name: true, integradorId: true, timezone: true } },
        },
      },
    },
  })

  for (const cam of cameras) {
    const cfId     = cam.site?.clienteFinalId
    const cfName   = cam.site?.clienteFinal?.name ?? 'Cliente'
    const siteName = cam.site?.name ?? 'Site'
    if (!cfId) continue

    // Lê grace period do config do cliente final (fallback para default)
    const config = await prisma.alertConfig.findUnique({
      where: { clienteFinalId: cfId },
      select: { offlineGraceSec: true },
    })
    const graceSec = config?.offlineGraceSec ?? DEFAULT_GRACE_SEC

    const lastOnline = cam.lastOnlineAt
    const graceCutoff = new Date(now.getTime() - graceSec * 1000)

    // ── Câmera offline? ────────────────────────────────────────────────────────
    const isOffline = !lastOnline || lastOnline < graceCutoff

    if (isOffline && cam.status === 'ACTIVE') {
      // Passou de ACTIVE → ERROR: atualiza status e dispara alerta
      await prisma.camera.update({
        where: { id: cam.id },
        data:  { status: 'ERROR' },
      })

      // Calcula duração offline
      const offlineSinceMs = lastOnline ? now.getTime() - lastOnline.getTime() : graceSec * 1000
      const offlineSince   = lastOnline
        ? lastOnline.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        : 'desconhecido'
      const offlineDuration = formatDuration(offlineSinceMs)

      const baseUrl    = process.env.PUBLIC_FRONTEND_URL?.replace('/login', '') ?? 'http://localhost:5173'
      const dashUrl    = `${baseUrl}/cameras`
      const settingsUrl = `${baseUrl}/settings`

      await alertService.dispatch({
        type:           'CAMERA_DOWN',
        severity:       'CRITICAL',
        clienteFinalId: cfId,
        cameraId:       cam.id,
        alertKey:       `camera_down:${cam.id}`,
        payload: {
          cameraName:     cam.name,
          location:       cam.location ?? siteName,
          siteName,
          clienteName:    cfName,
          offlineSince,
          offlineDuration,
          severity:       'CRÍTICO',
          description:    `A câmera "${cam.name}" parou de enviar imagens.`,
          dashboardUrl:   dashUrl,
          settingsUrl,
          escaladeNote:   '', // preenchido pelo alertService quando escalada
        },
      })

      logger.warn({ cameraId: cam.id, cameraName: cam.name, cfId }, 'watchdog_camera_offline')

    } else if (!isOffline && cam.status === 'ERROR') {
      // Câmera voltou: ERROR → ACTIVE + alerta de recovery
      await prisma.camera.update({
        where: { id: cam.id },
        data:  { status: 'ACTIVE', lastOnlineAt: now },
      })

      // Calcular por quanto tempo ficou offline: busca último SENT de CAMERA_DOWN
      const lastDown = await prisma.alertDelivery.findFirst({
        where:   { cameraId: cam.id, eventType: 'CAMERA_DOWN', status: 'SENT' },
        orderBy: { sentAt: 'desc' },
        select:  { sentAt: true },
      })
      const downDuration = lastDown
        ? formatDuration(now.getTime() - lastDown.sentAt.getTime())
        : 'desconhecido'

      const baseUrl     = process.env.PUBLIC_FRONTEND_URL?.replace('/login', '') ?? 'http://localhost:5173'
      const dashUrl     = `${baseUrl}/cameras`

      await alertService.dispatch({
        type:           'CAMERA_UP',
        severity:       'INFO',
        clienteFinalId: cfId,
        cameraId:       cam.id,
        alertKey:       `camera_up:${cam.id}`,
        payload: {
          cameraName:    cam.name,
          location:      cam.location ?? siteName,
          siteName,
          clienteName:   cfName,
          downDuration,
          recoveredAt:   now.toLocaleString('pt-BR'),
          dashboardUrl:  dashUrl,
          settingsUrl:   `${baseUrl}/settings`,
          escaladeNote:  '',
        },
      })

      logger.info({ cameraId: cam.id, cameraName: cam.name, cfId }, 'watchdog_camera_recovered')
    }
  }
}

// ── Formatação de duração ─────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const sec  = Math.floor(ms / 1000)
  if (sec < 60)      return `${sec}s`
  const min  = Math.floor(sec / 60)
  if (min < 60)      return `${min} min`
  const hour = Math.floor(min / 60)
  const remMin = min % 60
  return remMin > 0 ? `${hour}h ${remMin}min` : `${hour}h`
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

function start(): void {
  if (timer) return  // idempotente (HMR safe)
  logger.info({ tickMs: TICK_MS }, 'camera_watchdog_started')
  timer = setInterval(tick, TICK_MS)
  // Roda imediatamente na inicialização (sem esperar 1 min)
  setTimeout(tick, 5_000)
}

function stop(): void {
  if (timer) { clearInterval(timer); timer = null }
}

export const cameraWatchdogService = { start, stop }
