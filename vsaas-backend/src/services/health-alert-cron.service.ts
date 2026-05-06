/**
 * Health Alert cron — roda a cada 6h (mesmo intervalo do trial cron).
 *
 * Desligável via env HEALTH_ALERT_DISABLED=true.
 */
import { processHealthAlerts } from './health-alert.service'
import { logger } from '../lib/logger'

const INTERVAL_MS = 6 * 60 * 60 * 1000  // 6h
let timer: NodeJS.Timeout | null = null

async function tick() {
  try {
    const result = await processHealthAlerts()
    logger.info({
      total: result.total,
      alertsCreated: result.alertsCreated,
      alertsResolved: result.alertsResolved,
      byLevel: result.byLevel,
    }, 'health_alert_cron_tick')
  } catch (err) {
    logger.error({ err }, 'health_alert_cron_failed')
  }
}

export function startHealthAlertCron() {
  if (process.env.HEALTH_ALERT_DISABLED === 'true') {
    logger.info('health_alert_cron_disabled_via_env')
    return
  }
  if (timer) return
  // 60s após boot pra dar tempo do banco subir
  setTimeout(() => {
    tick().catch(err => logger.error({ err }, 'health_alert_cron_initial_failed'))
    timer = setInterval(tick, INTERVAL_MS)
  }, 60_000)
  logger.info({ intervalHours: INTERVAL_MS / 1000 / 60 / 60 }, 'health_alert_cron_started')
}

export function stopHealthAlertCron() {
  if (timer) clearInterval(timer)
  timer = null
}
