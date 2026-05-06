/**
 * Deal Registration cron — expira deals APPROVED após 30d sem atividade.
 * Roda 1×/dia (24h).
 */
import { expireOldDeals } from './deal-registration.service'
import { logger } from '../lib/logger'

const INTERVAL_MS = 24 * 60 * 60 * 1000
let timer: NodeJS.Timeout | null = null

async function tick() {
  try {
    const r = await expireOldDeals()
    if (r.expired > 0) logger.info({ expired: r.expired }, 'deal_registration_cron_tick')
  } catch (err) {
    logger.error({ err }, 'deal_registration_cron_failed')
  }
}

export function startDealRegistrationCron() {
  if (process.env.DEAL_REGISTRATION_DISABLED === 'true') return
  if (timer) return
  setTimeout(() => {
    tick().catch(err => logger.error({ err }, 'deal_registration_cron_initial_failed'))
    timer = setInterval(tick, INTERVAL_MS)
  }, 90_000)
  logger.info('deal_registration_cron_started')
}
