/**
 * Trial expiration cron — roda a cada 6h.
 *
 * Processa todos os trials, dispara lembretes T-7/T-3/T-1/T-0 e suspende
 * quem passou da data. Idempotente via trialNotificationsSent.
 *
 * Ativação: import + start() em src/app.ts (após ingestService etc).
 * Pode ser desligado via env TRIAL_EXPIRATION_DISABLED=true.
 */
import { processAllTrials } from './trial.service'
import { logger } from '../lib/logger'

const INTERVAL_MS = 6 * 60 * 60 * 1000  // 6h
let timer: NodeJS.Timeout | null = null

async function tick() {
  try {
    const result = await processAllTrials()
    logger.info({
      processed: result.processed,
      expired: result.expired,
      notified: result.notified.filter(n => n.count > 0),
    }, 'trial_cron_tick')
  } catch (err) {
    logger.error({ err }, 'trial_cron_failed')
  }
}

export function startTrialExpirationCron() {
  if (process.env.TRIAL_EXPIRATION_DISABLED === 'true') {
    logger.info('trial_cron_disabled_via_env')
    return
  }
  if (timer) return  // já rodando
  // Primeira execução em 30s (deixa app subir)
  setTimeout(() => {
    tick().catch(err => logger.error({ err }, 'trial_cron_initial_failed'))
    timer = setInterval(tick, INTERVAL_MS)
  }, 30_000)
  logger.info({ intervalHours: INTERVAL_MS / 1000 / 60 / 60 }, 'trial_cron_started')
}

export function stopTrialExpirationCron() {
  if (timer) clearInterval(timer)
  timer = null
}
