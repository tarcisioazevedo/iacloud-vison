/**
 * Storage Reconciliation — cron semanal que recalcula `StorageBucket.totalBytes`
 * e `objectCount` via `ListObjectsV2` (S3) e compara com o valor mantido pelo
 * `r2-event-consumer`. Corrige drift causado por:
 *
 *   - Mensagens perdidas (queue retention default 24h, consumer offline >24h)
 *   - Eventos sem `size` em DELETE/LifecycleDeletion (delta zero quando R2 omite)
 *   - Migrações manuais ou janelas em que o consumer estava desabilitado
 *
 * Estratégia:
 *   - Tick 1× por semana (configurável via env)
 *   - Para cada StorageBucket ativo, chama `r2Storage.getStats(integradorId)`
 *     (já existe; lista todos os objetos do bucket)
 *   - Compara medido vs registrado → calcula drift %
 *   - Atualiza StorageBucket com os valores corretos + lastReconciledAt
 *   - Loga drift; alerta se |drift| > STORAGE_RECONCILIATION_DRIFT_ALERT_PCT
 *
 * Custo:
 *   `getStats` faz N requests Class B ($0.36/M) — para um bucket com 200 mil
 *   objetos = ~200 requests = R$ 0,0004/semana. Trivial.
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { r2Storage } from './r2-storage.service'

const TICK_MS  = Number(process.env.STORAGE_RECONCILIATION_INTERVAL_MS ?? 7 * 24 * 60 * 60 * 1000)
const ENABLED  = process.env.STORAGE_RECONCILIATION_DISABLED !== 'true'
const ALERT_PCT = Number(process.env.STORAGE_RECONCILIATION_DRIFT_ALERT_PCT ?? 5)

let timer: NodeJS.Timeout | null = null
let lastTickAt: Date | null = null
let lastDriftReport: { bucketId: string; driftPct: number }[] = []

function pct(measured: number, recorded: number): number {
  if (recorded === 0 && measured === 0) return 0
  if (recorded === 0) return Number.POSITIVE_INFINITY
  return ((measured - recorded) / recorded) * 100
}

async function reconcileBucket(
  bucket: { id: string; integradorId: string; name: string; totalBytes: bigint; objectCount: number },
): Promise<{ driftBytesPct: number; driftCountPct: number }> {
  // r2Storage.getStats lista todos os objetos do bucket (recursivo).
  // Caro em buckets grandes — mas só roda 1x/semana.
  let stats: { totalBytes: number; count: number }
  try {
    stats = await r2Storage.getStats(bucket.integradorId)
  } catch (err) {
    logger.warn({ err, bucketId: bucket.id, name: bucket.name }, 'storage_reconcile_stats_failed')
    return { driftBytesPct: 0, driftCountPct: 0 }
  }

  const recordedBytes = Number(bucket.totalBytes)
  const driftBytesPct = pct(stats.totalBytes, recordedBytes)
  const driftCountPct = pct(stats.count, bucket.objectCount)

  // Atualiza com o valor medido (autoritativo) + timestamp
  await prisma.storageBucket.update({
    where: { id: bucket.id },
    data: {
      totalBytes:       BigInt(stats.totalBytes),
      objectCount:      stats.count,
      lastReconciledAt: new Date(),
      lastSyncAt:       new Date(),   // mantém compat com código legado
    },
  })

  if (Math.abs(driftBytesPct) > ALERT_PCT) {
    logger.warn({
      bucketId:      bucket.id,
      bucketName:    bucket.name,
      recordedBytes, measuredBytes: stats.totalBytes,
      driftBytesPct: driftBytesPct.toFixed(2),
      driftCountPct: driftCountPct.toFixed(2),
    }, 'storage_reconcile_drift_alert')
  } else {
    logger.info({
      bucketId:      bucket.id,
      bucketName:    bucket.name,
      driftBytesPct: driftBytesPct.toFixed(2),
    }, 'storage_reconcile_ok')
  }

  return { driftBytesPct, driftCountPct }
}

async function tick(): Promise<void> {
  if (!ENABLED) return
  if (!r2Storage.isEnabled()) {
    logger.info('storage_reconcile_skipped_no_r2')
    return
  }

  const buckets = await prisma.storageBucket.findMany({
    where: { active: true, type: 'R2' },
    select: { id: true, integradorId: true, name: true, totalBytes: true, objectCount: true },
  })

  const drifts: typeof lastDriftReport = []
  for (const b of buckets) {
    const { driftBytesPct } = await reconcileBucket(b)
    drifts.push({ bucketId: b.id, driftPct: driftBytesPct })
  }

  lastDriftReport = drifts
  lastTickAt      = new Date()
  logger.info({ buckets: buckets.length }, 'storage_reconcile_tick_complete')
}

export const storageReconciliation = {
  start(): void {
    if (!ENABLED) {
      logger.info('storage_reconcile_disabled')
      return
    }
    if (timer) return
    logger.info({ tickMs: TICK_MS, alertPct: ALERT_PCT }, 'storage_reconcile_starting')
    // Não rodar imediatamente no boot — espera primeiro intervalo
    timer = setInterval(() => {
      tick().catch(err => logger.error({ err }, 'storage_reconcile_tick_unhandled'))
    }, TICK_MS)
  },

  stop(): void {
    if (timer) { clearInterval(timer); timer = null }
  },

  /** Força um tick imediatamente — útil para super admin ou healthcheck. */
  async runOnce(): Promise<void> {
    await tick()
  },

  status() {
    return {
      enabled: ENABLED,
      running: !!timer,
      lastTickAt,
      lastDriftReport,
    }
  },
}
