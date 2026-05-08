/**
 * Storage Health Summary — Sprint 5 do plano docs/STORAGE-ARCHITECTURE.md.
 *
 * Cron diário (00:30 UTC) que agrega métricas dos últimos 24h em uma única
 * linha de dashboard. Útil para o super admin acompanhar saúde da
 * plataforma durante o soak test de 7 dias e a partir daí em operação
 * normal.
 *
 * Métricas coletadas:
 *   - StorageBucket count (total + ativo)
 *   - StorageUsage rows criadas nas últimas 24h (proxy de event consumer ativo)
 *   - RecordingSegment uploaded nas últimas 24h por câmera
 *   - StorageBillingSnapshot count + drift médio do mês corrente
 *   - RetentionUpgradeRequest count por status
 *   - Outliers detectados (LineItem.isOutlier=true)
 *
 * Output: in-memory snapshot expostos via GET /admin/health-summary
 *         + 1 log estruturado por dia para histórico (compatível com
 *         compliance_digest da Box).
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

const TICK_MS = Number(process.env.STORAGE_HEALTH_SUMMARY_INTERVAL_MS ?? 24 * 60 * 60 * 1000)
const ENABLED = process.env.STORAGE_HEALTH_SUMMARY_DISABLED !== 'true'

let timer: NodeJS.Timeout | null = null
let lastSummary: HealthSummary | null = null

export interface HealthSummary {
  generatedAt: Date
  windowHours: number

  // Storage layer
  buckets: {
    total: number
    active: number
    withRecentEvents: number
    avgStorageGb: number
  }
  usage: {
    rowsLast24h: number
    bytesLast24h: number
  }
  recording: {
    segmentsLast24h: number
    cameras: number
    failedUploads: number
    pendingUploads: number
  }

  // Billing layer
  billing: {
    snapshotsThisMonth: number
    avgDriftPct: number
    outliersThisMonth: number
    pendingUpgrades: number
  }

  // Saúde dos crons
  crons: {
    eventConsumerHealthy: boolean   // baseado em StorageBucket.lastEventTime
    reconciliationHealthy: boolean  // baseado em snapshot.reconciledAt
    billingHealthy: boolean         // baseado em StorageBillingSnapshot.generatedAt
  }
}

async function buildSummary(): Promise<HealthSummary> {
  const now = new Date()
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0))
  const yearMonth = `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, '0')}`

  // ── Storage ─────────────────────────────────────────────────────────────
  const buckets = await prisma.storageBucket.findMany({
    select: { id: true, active: true, totalBytes: true, lastEventTime: true },
  })
  const totalBuckets         = buckets.length
  const activeBuckets        = buckets.filter(b => b.active).length
  const withRecentEvents     = buckets.filter(b => b.lastEventTime && b.lastEventTime > last24h).length
  const avgStorageGb = buckets.length > 0
    ? Number((buckets.reduce((acc, b) => acc + Number(b.totalBytes), 0) / buckets.length / (1024 ** 3)).toFixed(3))
    : 0

  const usageAgg = await prisma.storageUsage.aggregate({
    where: { recordedAt: { gte: last24h } },
    _count: { _all: true },
    _sum:   { usedBytes: true },
  })

  // ── Recording ───────────────────────────────────────────────────────────
  const segmentsAgg = await prisma.recordingSegment.aggregate({
    where: { startedAt: { gte: last24h } },
    _count: { _all: true },
  })
  const camerasWithSegments = await prisma.recordingSegment.findMany({
    where: { startedAt: { gte: last24h } },
    distinct: ['cameraId'],
    select: { cameraId: true },
  })
  const failedUploads = await prisma.recordingSegment.count({
    where: { uploadStatus: 'FAILED', startedAt: { gte: last24h } },
  })
  const pendingUploads = await prisma.recordingSegment.count({
    where: { uploadStatus: 'PENDING', startedAt: { gte: last24h } },
  })

  // ── Billing ─────────────────────────────────────────────────────────────
  const snapshots = await prisma.storageBillingSnapshot.findMany({
    where: { periodYearMonth: yearMonth },
    select: { id: true, reconciliationDriftPct: true, reconciledAt: true, generatedAt: true },
  })
  const reconciled = snapshots.filter(s => s.reconciliationDriftPct != null)
  const avgDriftPct = reconciled.length > 0
    ? Number((reconciled.reduce((acc, s) => acc + Math.abs(Number(s.reconciliationDriftPct ?? 0)), 0) / reconciled.length).toFixed(2))
    : 0
  const outliers = await prisma.storageBillingLineItem.count({
    where: { isOutlier: true, snapshot: { periodYearMonth: yearMonth } },
  })
  const pendingUpgrades = await prisma.retentionUpgradeRequest.count({
    where: { status: 'PENDING_INTEGRADOR' },
  })

  // ── Saúde dos crons ─────────────────────────────────────────────────────
  // Heurística: se >50% dos buckets ativos têm lastEventTime nas últimas 24h,
  // o consumer está saudável (ou se não há evento esperado por baixo volume).
  const eventConsumerHealthy = activeBuckets === 0 || withRecentEvents / activeBuckets >= 0.5
  const reconciliationHealthy = snapshots.length === 0 || reconciled.length / snapshots.length >= 0.5
  const billingHealthy = snapshots.some(s => s.generatedAt > last24h) || activeBuckets === 0

  return {
    generatedAt: now,
    windowHours: 24,
    buckets: {
      total: totalBuckets,
      active: activeBuckets,
      withRecentEvents,
      avgStorageGb,
    },
    usage: {
      rowsLast24h: usageAgg._count._all,
      bytesLast24h: Number(usageAgg._sum.usedBytes ?? 0),
    },
    recording: {
      segmentsLast24h: segmentsAgg._count._all,
      cameras:         camerasWithSegments.length,
      failedUploads,
      pendingUploads,
    },
    billing: {
      snapshotsThisMonth: snapshots.length,
      avgDriftPct,
      outliersThisMonth:  outliers,
      pendingUpgrades,
    },
    crons: {
      eventConsumerHealthy,
      reconciliationHealthy,
      billingHealthy,
    },
  }
}

async function tick(): Promise<void> {
  if (!ENABLED) return
  try {
    const summary = await buildSummary()
    lastSummary = summary
    logger.info({
      buckets: summary.buckets,
      usage: summary.usage,
      recording: summary.recording,
      billing: summary.billing,
      crons: summary.crons,
    }, 'storage_health_summary')
  } catch (err) {
    logger.error({ err }, 'storage_health_summary_failed')
  }
}

export const storageHealthSummary = {
  start(): void {
    if (!ENABLED) {
      logger.info('storage_health_summary_disabled')
      return
    }
    if (timer) return
    logger.info({ tickMs: TICK_MS }, 'storage_health_summary_starting')

    // Roda 1x no boot (5s depois para deixar boot leve)
    setTimeout(() => {
      tick().catch(err => logger.error({ err }, 'storage_health_summary_boot_failed'))
    }, 5000)

    // Cron diário
    timer = setInterval(() => {
      tick().catch(err => logger.error({ err }, 'storage_health_summary_unhandled'))
    }, TICK_MS)
  },

  stop(): void {
    if (timer) { clearInterval(timer); timer = null }
  },

  /** Endpoint admin consume isso. */
  getLast(): HealthSummary | null { return lastSummary },

  async runOnce(): Promise<HealthSummary> {
    const s = await buildSummary()
    lastSummary = s
    return s
  },
}
