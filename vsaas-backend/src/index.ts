import 'dotenv/config'
// Secrets bootstrap DEVE rodar logo após dotenv: popula process.env.X a partir
// de X_FILE (Docker secrets em /run/secrets/*). Sem isso, imports abaixo que
// lêem process.env.JWT_SECRET etc. veriam undefined em prod (env vars agora
// chegam só como _FILE).
import './lib/secrets-bootstrap'
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
// FCB-002 Sprint 0 wiring 2026-05-06: cron que detecta Boxes sem heartbeat
// e dispara alerta WARNING (15min) → CRITICAL (30min) com transição de status
// ONLINE → DEGRADED → OFFLINE.
import { startStaleEdgeDetectionJob } from './jobs/detect-stale-edge'
// Worker: detecta horas com gravação mas sem sprite e gera Cloud-side via
// ffmpeg. Garante cobertura 100% mesmo se a Box falhar. Configurável via
// SPRITE_BACKFILL_ENABLED / SPRITE_BACKFILL_INTERVAL_SEC / etc.
import { startSpriteBackfillWorker } from './services/sprite-backfill-worker'
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

  // FCB-002: stale edge detection — env STALE_EDGE_CHECK_INTERVAL_SEC (default 300s)
  // STALE_EDGE_DEGRADE_AFTER_MIN (default 15) / STALE_EDGE_OFFLINE_AFTER_MIN (default 30)
  startStaleEdgeDetectionJob()

  // Sprite backfill: garante preview no hover pra qualquer hora com gravação.
  // Roda a cada 5min processando até 5 horas pendentes por ciclo.
  startSpriteBackfillWorker()
}

bootstrap().catch(async err => {
  logger.fatal({ err }, 'bootstrap_failed')
  Sentry.captureException(err)
  await Sentry.flush(2000)
  // Bootstrap é fatal — sem banco/config o processo não tem como servir.
  // Deixar o orquestrador (docker/cloud run) dar restart com backoff.
  gracefulShutdown('bootstrap_failed', 1)
})
