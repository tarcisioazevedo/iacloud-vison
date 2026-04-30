/**
 * digest.service.ts — Resumo diário de alertas por e-mail.
 *
 * Check a cada 5 minutos:
 *   1. Busca AlertConfig[] onde digestEnabled = true
 *   2. Para cada config: verifica se digestTime (no timezone do CF) já passou hoje
 *      e não foi enviado ainda (usa SystemConfig key: digest_sent_<cfId>_<date>)
 *   3. Agrega AlertDelivery das últimas 24h
 *   4. Dispara via alertService.dispatch({ type: 'DIGEST' })
 */

import { prisma }       from '../lib/prisma'
import { logger }       from '../lib/logger'
import { alertService } from './alert.service'

const CHECK_INTERVAL_MS = 5 * 60 * 1000  // 5 minutos

let timer: NodeJS.Timeout | null = null

// ── Tick ──────────────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  try {
    const configs = await prisma.alertConfig.findMany({
      where:   { digestEnabled: true },
      include: { clienteFinal: { select: { id: true, name: true } } },
    })

    for (const config of configs) {
      await tryDispatchDigest(config)
    }
  } catch (err: any) {
    logger.warn({ err: err.message }, 'digest_tick_error')
  }
}

async function tryDispatchDigest(config: {
  clienteFinalId: string
  digestTime:     string
  digestTimezone: string
  clienteFinal:   { id: string; name: string }
}): Promise<void> {
  const { clienteFinalId, digestTime, digestTimezone } = config
  const tz = digestTimezone ?? 'America/Sao_Paulo'

  // Data/hora atual no timezone do CF
  const now      = new Date()
  const dateStr  = now.toLocaleDateString('pt-BR', { timeZone: tz }).split('/').reverse().join('-') // YYYY-MM-DD
  const hhmm     = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz })

  // Verifica se passou do horário configurado
  if (hhmm < digestTime) return  // ainda não chegou a hora

  // Verifica se já enviou hoje
  const sentKey = `digest_sent_${clienteFinalId}_${dateStr}`
  const alreadySent = await prisma.systemConfig.findUnique({ where: { key: sentKey } })
  if (alreadySent) return

  // Agrega alertas das últimas 24h
  const since  = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const deliveries = await prisma.alertDelivery.findMany({
    where: {
      clienteFinalId,
      status:  'SENT',
      sentAt:  { gte: since },
      eventType: { not: 'DIGEST' },  // não conta digests anteriores
    },
    orderBy: { sentAt: 'desc' },
    take:    500,
  })

  if (deliveries.length === 0) {
    // Sem eventos — não envia digest (mas marca como verificado)
    await prisma.systemConfig.upsert({
      where:  { key: sentKey },
      update: { value: 'no_events' },
      create: { key: sentKey, value: 'no_events' },
    })
    return
  }

  // Contagens por severidade
  const countCritical = deliveries.filter(d => d.severity === 'CRITICAL').length
  const countWarning  = deliveries.filter(d => d.severity === 'WARNING').length
  const countInfo     = deliveries.filter(d => d.severity === 'INFO').length

  // Câmeras que ficaram offline
  const cameraDownSet = new Set(
    deliveries
      .filter(d => d.eventType === 'CAMERA_DOWN' && d.cameraId)
      .map(d => d.cameraId!)
  )
  const cameraDownList = cameraDownSet.size > 0
    ? [...cameraDownSet].map(id => {
        const meta = deliveries.find(d => d.cameraId === id)?.metadataJson as any
        return `  • ${meta?.cameraName ?? id}`
      }).join('\n')
    : '  (nenhuma)'

  // Triggers disparados
  const triggerDeliveries = deliveries.filter(d => d.eventType === 'TRIGGER_FIRE')
  const triggerList = triggerDeliveries.length > 0
    ? [...new Set(triggerDeliveries.map(d => {
        const meta = d.metadataJson as any
        return `  • ${meta?.triggerName ?? 'Trigger'} — ${meta?.cameraName ?? ''}`
      }))].join('\n')
    : '  (nenhum)'

  const baseUrl = process.env.PUBLIC_FRONTEND_URL?.replace('/login', '') ?? 'http://localhost:5173'
  const dateFormatted = now.toLocaleDateString('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' })
  const periodStart   = since.toLocaleString('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  const periodEnd     = now.toLocaleString('pt-BR',   { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

  await alertService.dispatch({
    type:           'DIGEST',
    severity:       'INFO',
    clienteFinalId,
    alertKey:       `digest:${clienteFinalId}:${dateStr}`,
    payload: {
      clienteName:    config.clienteFinal.name,
      date:           dateFormatted,
      periodStart,
      periodEnd,
      countCritical:  String(countCritical),
      countWarning:   String(countWarning),
      countInfo:      String(countInfo),
      cameraDownList,
      triggerList,
      dashboardUrl:   `${baseUrl}/cameras`,
      settingsUrl:    `${baseUrl}/settings`,
      escaladeNote:   '',
    },
  })

  // Marca como enviado para não repetir hoje
  await prisma.systemConfig.upsert({
    where:  { key: sentKey },
    update: { value: now.toISOString() },
    create: { key: sentKey, value: now.toISOString() },
  })

  logger.info({ clienteFinalId, date: dateStr, events: deliveries.length }, 'digest_sent')
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

function start(): void {
  if (timer) return
  logger.info({ intervalMs: CHECK_INTERVAL_MS }, 'digest_service_started')
  timer = setInterval(tick, CHECK_INTERVAL_MS)
  setTimeout(tick, 10_000)  // primeira verificação em 10s
}

function stop(): void {
  if (timer) { clearInterval(timer); timer = null }
}

export const digestService = { start, stop }
