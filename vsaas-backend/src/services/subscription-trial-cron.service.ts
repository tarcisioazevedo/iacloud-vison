/**
 * Subscription trial cron — roda a cada 1h.
 *
 * Processa subs em status TRIAL:
 *   - vencidas → CANCELED + invalida capability cache
 *   - vencendo em 1/3/7 dias → log (lembrete real depende de SMTP integrador)
 *
 * Ativação: import + startSubscriptionTrialCron() em src/app.ts.
 * Pode ser desligado via env SUBSCRIPTION_TRIAL_CRON_DISABLED=true.
 */
import { processExpiredTrials } from './subscription-trial.service'
import { logger } from '../lib/logger'

const INTERVAL_MS = 60 * 60 * 1000 // 1h
let timer: NodeJS.Timeout | null = null

async function tick() {
  try {
    const result = await processExpiredTrials()
    logger.info({
      expired:  result.expired,
      warned:   result.warned,
      warnings: result.warnings.filter(w => w.count > 0),
    }, 'subscription_trial_cron_tick')
  } catch (err) {
    logger.error({ err }, 'subscription_trial_cron_failed')
  }
}

export function startSubscriptionTrialCron() {
  if (process.env.SUBSCRIPTION_TRIAL_CRON_DISABLED === 'true') {
    logger.info('subscription_trial_cron_disabled_via_env')
    return
  }
  if (timer) return

  // Primeira execução em 30s (deixa app subir antes de tocar no DB)
  setTimeout(() => {
    tick().catch(err => logger.error({ err }, 'subscription_trial_cron_initial_failed'))
    timer = setInterval(tick, INTERVAL_MS)
  }, 30_000)

  logger.info({ intervalMin: INTERVAL_MS / 60_000 }, 'subscription_trial_cron_started')
}

export function stopSubscriptionTrialCron() {
  if (timer) clearInterval(timer)
  timer = null
}
