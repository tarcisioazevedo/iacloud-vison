import 'dotenv/config'
import { initSentry, Sentry } from './lib/sentry'

// Sentry DEVE inicializar antes de qualquer import que registre handlers.
initSentry()

import { app } from './app'
import { prisma } from './lib/prisma'
import { logger } from './lib/logger'
import { bigQueryService } from './services/bigquery.service'
import { gcsService } from './services/gcs.service'
import { runEvidenceCleanup } from './jobs/evidence-cleanup'
import { runMonthlyQuotaReset } from './jobs/quota-reset'
import {
  installProcessGuards,
  registerHttpServer,
  gracefulShutdown,
} from './lib/process-guards'

const PORT = Number(process.env.PORT ?? 3000)

// Instala guards ANTES de qualquer outra coisa para capturar erros de bootstrap.
installProcessGuards()

async function bootstrap(): Promise<void> {
  // Conectar banco
  await prisma.$connect()
  logger.info('database_connected')

  // Garantir tabela BigQuery (idempotente)
  if (process.env.NODE_ENV === 'production') {
    await bigQueryService.ensureTable().catch(err =>
      logger.warn({ err }, 'bq_ensure_table_skipped'),
    )

    // Aplicar lifecycle GCS (72h TTL) — idempotente
    await gcsService.applyLifecyclePolicy().catch(err =>
      logger.warn({ err }, 'gcs_lifecycle_skipped'),
    )
  }

  scheduleJobs()

  const server = app.listen(PORT, () => {
    logger.info({ port: PORT, env: process.env.NODE_ENV }, 'server_started')
  })

  // Timeouts conservadores: evita slowloris e segura conexões penduradas.
  server.keepAliveTimeout = 65_000
  server.headersTimeout = 66_000
  server.requestTimeout = 30_000

  registerHttpServer(server)
}

function scheduleJobs(): void {
  // Evidence cleanup: a cada hora
  const evidenceInterval = setInterval(() => {
    runEvidenceCleanup().catch(err =>
      logger.error({ err }, 'evidence_cleanup_job_error'),
    )
  }, 60 * 60 * 1000)
  evidenceInterval.unref()

  // Quota reset: verificar a cada hora se é dia 1
  const quotaInterval = setInterval(() => {
    const now = new Date()
    if (now.getDate() === 1 && now.getHours() === 0) {
      runMonthlyQuotaReset().catch(err =>
        logger.error({ err }, 'quota_reset_job_error'),
      )
    }
  }, 60 * 60 * 1000)
  quotaInterval.unref()
}

bootstrap().catch(async err => {
  logger.fatal({ err }, 'bootstrap_failed')
  Sentry.captureException(err)
  await Sentry.flush(2000)
  // Bootstrap é fatal — sem banco/config o processo não tem como servir.
  // Deixar o orquestrador (docker/cloud run) dar restart com backoff.
  gracefulShutdown('bootstrap_failed', 1)
})
