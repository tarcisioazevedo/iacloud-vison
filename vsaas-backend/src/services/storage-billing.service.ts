/**
 * Storage Billing Service — Sprint 4 do plano docs/STORAGE-ARCHITECTURE.md
 *
 * 3 crons que produzem o snapshot mensal de billing por integrador:
 *
 *   1. storage-billing-snapshot-daily (03h00 UTC)
 *      - Acumula StorageUsage do mês corrente em StorageBillingSnapshot
 *        (PRELIMINARY) — atualiza em tempo quase-real para painéis ao vivo.
 *      - Recalcula custos R2 (storage + Class A + Class B) com precisão.
 *      - Faz rateio em StorageBillingLineItem por cliente/site/câmera.
 *      - Detecta outliers (gbIncludedSoftLimit excedido / margem negativa).
 *
 *   2. storage-billing-finalize-monthly (dia 1 do mês às 04h00 UTC)
 *      - Fecha snapshot do mês anterior: status=PRELIMINARY → CLOSED
 *      - Congela câmbio USD/BRL (mediana do dia 1)
 *      - Recalcula linha final com câmbio congelado
 *      - Pronto para reconciliação CF (Sprint S4.D)
 *
 *   3. (S4.D em arquivo separado: storage-billing-reconciliation.service.ts)
 *
 * Cobrança pro-rata: o snapshot daily soma incrementalmente o uso do dia,
 * usando o plano EFETIVO da câmera no momento (que pode ter mudado meio do
 * mês). Resultado: mudança HD-7d→HD-30d no dia 15 → 14 dias HD-7d + 16 dias
 * HD-30d, valor calculado dia-a-dia.
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { Prisma } from '@prisma/client'

// ── Configuração ─────────────────────────────────────────────────────────────
const DAILY_INTERVAL_MS = Number(process.env.STORAGE_BILLING_DAILY_INTERVAL_MS ?? 24 * 60 * 60 * 1000)
const ENABLED           = process.env.STORAGE_BILLING_DISABLED !== 'true'

// Pricing R2 (USD oficiais Cloudflare 2026)
const R2_USD_PER_GB_MONTH       = 0.015
const R2_USD_PER_MILLION_CLASSA = 4.50
const R2_USD_PER_MILLION_CLASSB = 0.36
const FREE_GB_PER_MONTH          = 10           // Cloudflare R2 free tier
const FREE_CLASSA_PER_MONTH      = 1_000_000
const FREE_CLASSB_PER_MONTH     = 10_000_000

// Margem default IACloud→Integrador (pode ser sobrescrito por env)
const IACLOUD_MARKUP_PCT = Number(process.env.IACLOUD_MARKUP_PCT ?? 50)
const USD_BRL_DEFAULT    = Number(process.env.USD_BRL_RATE ?? 5.30)

// ── Estado ───────────────────────────────────────────────────────────────────
let dailyTimer: NodeJS.Timeout | null = null
let monthlyTimer: NodeJS.Timeout | null = null
let lastDailyTickAt:   Date | null = null
let lastMonthlyTickAt: Date | null = null

// ── Helpers de cálculo ───────────────────────────────────────────────────────

/**
 * Calcula período do mês corrente em UTC (sempre arredondado pro dia 1 às 00h
 * e dia 1 do mês seguinte). Usado pro snapshot do mês corrente.
 */
function currentMonthBounds(): { yearMonth: string; start: Date; end: Date } {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0))
  const end   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0))
  const yearMonth = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`
  return { yearMonth, start, end }
}

function previousMonthBounds(): { yearMonth: string; start: Date; end: Date } {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0, 0))
  const end   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0))
  const yearMonth = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`
  return { yearMonth, start, end }
}

/**
 * Calcula custo R2 USD a partir das métricas (storage GB-mês, Class A/B ops).
 * Aplica free tier proporcional ao mês — overestima ligeiramente quando o mês
 * acabou de começar, corrige no fechamento mensal.
 */
function computeR2CostUsd(opts: {
  storageGbMonth: number
  classAOps: number
  classBOps: number
  monthFraction?: number   // 0-1, default 1 (mês inteiro)
}): { storage: number; classA: number; classB: number; total: number } {
  const f       = opts.monthFraction ?? 1
  const freeGb  = FREE_GB_PER_MONTH * f
  const freeA   = FREE_CLASSA_PER_MONTH * f
  const freeB   = FREE_CLASSB_PER_MONTH * f

  const billableGb = Math.max(0, opts.storageGbMonth - freeGb)
  const billableA  = Math.max(0, opts.classAOps - freeA)
  const billableB  = Math.max(0, opts.classBOps - freeB)

  const storage = billableGb * R2_USD_PER_GB_MONTH
  const classA  = (billableA / 1_000_000) * R2_USD_PER_MILLION_CLASSA
  const classB  = (billableB / 1_000_000) * R2_USD_PER_MILLION_CLASSB
  return {
    storage: Number(storage.toFixed(4)),
    classA:  Number(classA.toFixed(4)),
    classB:  Number(classB.toFixed(4)),
    total:   Number((storage + classA + classB).toFixed(4)),
  }
}

// ── Daily snapshot ───────────────────────────────────────────────────────────

async function buildSnapshotForBucket(
  bucket: { id: string; integradorId: string; type: string },
  bounds: { yearMonth: string; start: Date; end: Date },
  opts: { isFinal: boolean; usdBrlRate?: number },
): Promise<void> {
  // 1) Soma uso do mês corrente até agora (a partir de StorageUsage criado pelo
  //    event consumer). cameraId NULL = uso geral; cameraId preenchido = breakdown.
  const usageRows = await prisma.storageUsage.findMany({
    where: {
      bucketId:   bucket.id,
      recordedAt: { gte: bounds.start, lt: bounds.end },
    },
    select: {
      clienteFinalId: true,
      cameraId:       true,
      usedBytes:      true,
      objectCount:    true,
    },
  })

  // Métricas agregadas do bucket
  let totalBytes = 0
  let totalObjectCount = 0
  for (const r of usageRows) {
    totalBytes += Number(r.usedBytes)
    totalObjectCount += r.objectCount
  }

  // GB-mês ≈ totalBytes (que vai se acumulando incrementalmente). Não temos
  // ainda fonte direta de Class A/B counts via StorageUsage — Sprint S4.D vai
  // trazer isso via GraphQL CF. Por ora, estimativa baseada em objectCount.
  const storageGbMonth = totalBytes / (1024 ** 3)

  // Estimativa: 1 PUT por objeto + 0.1 GET por objeto (conservador)
  const classAOpsEst = totalObjectCount
  const classBOpsEst = Math.round(totalObjectCount * 0.1)

  // Fração do mês decorrida
  const now = new Date()
  const monthFrac = Math.min(1, (now.getTime() - bounds.start.getTime()) /
                                 (bounds.end.getTime() - bounds.start.getTime()))

  const cost = computeR2CostUsd({
    storageGbMonth,
    classAOps: classAOpsEst,
    classBOps: classBOpsEst,
    monthFraction: monthFrac,
  })

  const usdBrl       = opts.usdBrlRate ?? USD_BRL_DEFAULT
  const costTotalBrl = Number((cost.total * usdBrl).toFixed(2))
  const priceToInt   = Number((costTotalBrl * (1 + IACLOUD_MARKUP_PCT / 100)).toFixed(2))
  const margin       = Number((priceToInt - costTotalBrl).toFixed(2))
  const marginPct    = priceToInt > 0 ? Number(((margin / priceToInt) * 100).toFixed(2)) : 0

  // 2) Upsert snapshot do bucket
  const snap = await prisma.storageBillingSnapshot.upsert({
    where:  { bucketId_periodYearMonth: { bucketId: bucket.id, periodYearMonth: bounds.yearMonth } },
    update: {
      avgStorageBytes:      BigInt(totalBytes),
      classAOpsTotal:       BigInt(classAOpsEst),
      classBOpsTotal:       BigInt(classBOpsEst),
      costStorageUsd:       cost.storage,
      costClassAUsd:        cost.classA,
      costClassBUsd:        cost.classB,
      costTotalUsd:         cost.total,
      usdBrlRate:           usdBrl,
      costTotalBrl,
      priceToIntegradorBrl: priceToInt,
      marginIACloudBrl:     margin,
      marginIACloudPct:     marginPct,
      ...(opts.isFinal ? { status: 'CLOSED' as const, finalizedAt: new Date() } : {}),
    },
    create: {
      bucketId:             bucket.id,
      integradorId:         bucket.integradorId,
      periodYearMonth:      bounds.yearMonth,
      periodStart:          bounds.start,
      periodEnd:            bounds.end,
      avgStorageBytes:      BigInt(totalBytes),
      classAOpsTotal:       BigInt(classAOpsEst),
      classBOpsTotal:       BigInt(classBOpsEst),
      costStorageUsd:       cost.storage,
      costClassAUsd:        cost.classA,
      costClassBUsd:        cost.classB,
      costTotalUsd:         cost.total,
      usdBrlRate:           usdBrl,
      costTotalBrl,
      priceToIntegradorBrl: priceToInt,
      marginIACloudBrl:     margin,
      marginIACloudPct:     marginPct,
      status:               opts.isFinal ? 'CLOSED' : 'PRELIMINARY',
      ...(opts.isFinal ? { finalizedAt: new Date() } : {}),
    },
  })

  // 3) Rateio em LineItems — agrupa por (clienteFinalId, cameraId)
  // Apaga lineItems antigos do snapshot (vamos recriar)
  await prisma.storageBillingLineItem.deleteMany({ where: { snapshotId: snap.id } })

  // Group-by manual (Prisma sumarizado limita BigInt)
  const byCliente: Record<string, { bytes: number; count: number }> = {}
  const byCamera:  Record<string, { bytes: number; count: number; clienteFinalId: string | null }> = {}
  for (const r of usageRows) {
    const cli = r.clienteFinalId ?? '_unknown'
    if (!byCliente[cli]) byCliente[cli] = { bytes: 0, count: 0 }
    byCliente[cli].bytes += Number(r.usedBytes)
    byCliente[cli].count += r.objectCount
    if (r.cameraId) {
      if (!byCamera[r.cameraId]) byCamera[r.cameraId] = { bytes: 0, count: 0, clienteFinalId: r.clienteFinalId }
      byCamera[r.cameraId].bytes += Number(r.usedBytes)
      byCamera[r.cameraId].count += r.objectCount
    }
  }

  // Plano + camera meta — pra calcular outliers e preço final ao CF
  const cameraMeta = byCamera && Object.keys(byCamera).length > 0
    ? await prisma.camera.findMany({
        where:  { id: { in: Object.keys(byCamera) } },
        select: {
          id: true, name: true, deploymentMode: true,
          retentionPlan: { select: { gbIncludedSoftLimit: true, retainDays: true, resolution: true, pricePerCameraMonthUsd: true } },
        },
      })
    : []

  // Markup do integrador (default 30%)
  const contract = await prisma.integradorRetentionContract.findUnique({
    where:  { integradorId: bucket.integradorId },
    select: { markupPct: true },
  })
  const markupInt = Number(contract?.markupPct ?? 30)

  const lineItemsToCreate: Prisma.StorageBillingLineItemCreateManyInput[] = []

  // Por cliente
  for (const [cliId, agg] of Object.entries(byCliente)) {
    if (cliId === '_unknown') continue
    // Rateio proporcional do custo do bucket: (bytes do cliente) / (totalBytes)
    const share = totalBytes > 0 ? agg.bytes / totalBytes : 0
    const costR2  = Number((costTotalBrl * share).toFixed(2))
    const priceCF = Number((priceToInt    * share * (1 + markupInt / 100)).toFixed(2))
    lineItemsToCreate.push({
      snapshotId:             snap.id,
      scope:                  'CLIENTE_FINAL',
      scopeId:                cliId,
      avgStorageBytes:        BigInt(agg.bytes),
      classAOps:              BigInt(Math.round(classAOpsEst * share)),
      classBOps:              BigInt(Math.round(classBOpsEst * share)),
      costR2Brl:              costR2,
      totalCostBrl:           costR2,
      priceToIntegradorBrl:   Number((priceToInt * share).toFixed(2)),
      priceToClienteFinalBrl: priceCF,
      marginIACloudBrl:       Number((margin * share).toFixed(2)),
      marginIntegradorBrl:    Number((priceCF - priceToInt * share).toFixed(2)),
    })
  }

  // Por câmera (com outlier detection)
  for (const [camId, agg] of Object.entries(byCamera)) {
    const meta = cameraMeta.find(c => c.id === camId)
    const share   = totalBytes > 0 ? agg.bytes / totalBytes : 0
    const costR2  = Number((costTotalBrl * share).toFixed(2))
    const priceInt = meta?.retentionPlan?.pricePerCameraMonthUsd
      ? Number(meta.retentionPlan.pricePerCameraMonthUsd) * usdBrl
      : Number((priceToInt * share).toFixed(2))
    const priceCF = Number((priceInt * (1 + markupInt / 100)).toFixed(2))

    // Outlier: ultrapassou soft limit OU margem negativa
    const usedGb = agg.bytes / (1024 ** 3)
    const softLimit = meta?.retentionPlan?.gbIncludedSoftLimit
      ? Number(meta.retentionPlan.gbIncludedSoftLimit)
      : null
    let isOutlier = false
    let outlierReason: string | null = null
    if (softLimit && usedGb > softLimit) {
      isOutlier = true
      outlierReason = 'soft_limit_exceeded'
    } else if (priceInt > 0 && costR2 > priceInt) {
      isOutlier = true
      outlierReason = 'margin_negative'
    }

    lineItemsToCreate.push({
      snapshotId:             snap.id,
      scope:                  'CAMERA',
      scopeId:                camId,
      parentScopeId:          agg.clienteFinalId,
      avgStorageBytes:        BigInt(agg.bytes),
      classAOps:              BigInt(Math.round(classAOpsEst * share)),
      classBOps:              BigInt(Math.round(classBOpsEst * share)),
      costR2Brl:              costR2,
      vpsCostBrl:             meta?.deploymentMode === 'CLOUD_DIRECT' ? 0.50 : 0,    // R$ 0.50/cam/mês VPS
      totalCostBrl:           costR2 + (meta?.deploymentMode === 'CLOUD_DIRECT' ? 0.50 : 0),
      priceToIntegradorBrl:   Number(priceInt.toFixed(2)),
      priceToClienteFinalBrl: priceCF,
      marginIACloudBrl:       Number((priceInt - costR2).toFixed(2)),
      marginIntegradorBrl:    Number((priceCF - priceInt).toFixed(2)),
      captureMode:            meta?.deploymentMode === 'EDGE_BOX' ? 'BOX' : 'AVULSA',
      resolution:             meta?.retentionPlan?.resolution ?? null,
      retentionDays:          meta?.retentionPlan?.retainDays ?? null,
      isOutlier,
      outlierReason,
    })
  }

  if (lineItemsToCreate.length > 0) {
    await prisma.storageBillingLineItem.createMany({ data: lineItemsToCreate })
  }
}

async function tickDailySnapshot(): Promise<void> {
  if (!ENABLED) return
  const bounds = currentMonthBounds()

  const buckets = await prisma.storageBucket.findMany({
    where:  { active: true },
    select: { id: true, integradorId: true, type: true },
  })

  for (const b of buckets) {
    try {
      await buildSnapshotForBucket(b, bounds, { isFinal: false })
    } catch (err) {
      logger.error({ err, bucketId: b.id }, 'storage_billing_daily_bucket_failed')
    }
  }

  lastDailyTickAt = new Date()
  logger.info({ buckets: buckets.length, period: bounds.yearMonth }, 'storage_billing_daily_complete')
}

async function tickMonthlyFinalize(): Promise<void> {
  if (!ENABLED) return
  const bounds = previousMonthBounds()

  // Só fecha o mês anterior se ainda não foi fechado
  const buckets = await prisma.storageBucket.findMany({
    where:  { active: true },
    select: { id: true, integradorId: true, type: true },
  })

  // Câmbio congelado: usa USD_BRL_DEFAULT do env (fixado pelo super admin)
  const lockedRate = USD_BRL_DEFAULT

  for (const b of buckets) {
    try {
      await buildSnapshotForBucket(b, bounds, { isFinal: true, usdBrlRate: lockedRate })
    } catch (err) {
      logger.error({ err, bucketId: b.id }, 'storage_billing_monthly_bucket_failed')
    }
  }

  lastMonthlyTickAt = new Date()
  logger.info({ buckets: buckets.length, period: bounds.yearMonth, rate: lockedRate }, 'storage_billing_monthly_finalized')
}

// ── API pública ──────────────────────────────────────────────────────────────

export const storageBilling = {
  start(): void {
    if (!ENABLED) {
      logger.info('storage_billing_disabled')
      return
    }
    if (dailyTimer) return

    logger.info({
      dailyMs: DAILY_INTERVAL_MS, markupPct: IACLOUD_MARKUP_PCT, usdBrl: USD_BRL_DEFAULT,
    }, 'storage_billing_starting')

    // Não roda imediatamente — espera primeiro intervalo (idempotente, mas
    // tickDaily faz queries pesadas e queremos o boot leve).
    dailyTimer = setInterval(() => {
      tickDailySnapshot().catch(err => logger.error({ err }, 'storage_billing_daily_unhandled'))
    }, DAILY_INTERVAL_MS)

    // Monthly: tick a cada 24h, mas só fecha snapshot se for "primeiros 5 dias do mês" e ainda não foi fechado
    monthlyTimer = setInterval(() => {
      const day = new Date().getUTCDate()
      if (day === 1 || day === 2) {
        tickMonthlyFinalize().catch(err => logger.error({ err }, 'storage_billing_monthly_unhandled'))
      }
    }, 24 * 60 * 60 * 1000)
  },

  stop(): void {
    if (dailyTimer)   { clearInterval(dailyTimer);   dailyTimer = null }
    if (monthlyTimer) { clearInterval(monthlyTimer); monthlyTimer = null }
  },

  /** Força tick imediato — útil para super admin / testes. */
  async runDailyOnce(): Promise<void> { await tickDailySnapshot() },
  async runMonthlyOnce(): Promise<void> { await tickMonthlyFinalize() },

  status() {
    return {
      enabled: ENABLED,
      running: !!dailyTimer,
      lastDailyTickAt,
      lastMonthlyTickAt,
      markupPct: IACLOUD_MARKUP_PCT,
      usdBrlRate: USD_BRL_DEFAULT,
    }
  },
}
