/**
 * Storage Billing Reconciliation — Sprint 4 S4.D
 *
 * Cron que cruza nossa medição interna (StorageBillingSnapshot) com os números
 * AUTORITATIVOS da Cloudflare obtidos via GraphQL Analytics (datasets
 * r2StorageAdaptiveGroups + r2OperationsAdaptiveGroups). Detecta drift e
 * alerta quando passar do limite configurado.
 *
 * Cadência: 1× por dia (default). O dia 5 do mês é especialmente importante
 * porque a fatura mensal CF do mês anterior já está fechada e os números
 * reais estão estabilizados.
 *
 * Permissões necessárias no token CF:
 *   - Workers R2 Storage:Read (não usado aqui, mas standard)
 *   - Account Analytics:Read (CRÍTICO para o GraphQL)
 *
 * Sem `R2_API_TOKEN` configurado → modo no-op silencioso.
 *
 * Validado em 2026-05-07 com query real retornando 5 buckets com payloadSize,
 * objectCount, e operações por actionType (PutObject success/userError, HeadBucket, HeadObject).
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

// ── Configuração ─────────────────────────────────────────────────────────────
const ACCOUNT_ID  = process.env.R2_ACCOUNT_ID ?? ''
const API_TOKEN   = process.env.R2_API_TOKEN  ?? ''
const TICK_MS     = Number(process.env.STORAGE_BILLING_RECONCILE_INTERVAL_MS ?? 24 * 60 * 60 * 1000)
const ALERT_PCT   = Number(process.env.STORAGE_BILLING_DRIFT_ALERT_PCT ?? 5)
const ENABLED     = process.env.STORAGE_BILLING_RECONCILE_DISABLED !== 'true'

const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql'

// Lista oficial CF de operações Class A vs Class B (2026)
// Class A: writes (PUT, POST, COPY, multipart, list, lifecycle put)
// Class B: reads (GET, HEAD)
const CLASS_A_ACTIONS = new Set([
  'PutObject', 'CopyObject', 'CompleteMultipartUpload', 'CreateMultipartUpload',
  'UploadPart', 'UploadPartCopy', 'PutBucketEncryption', 'PutBucketLifecycleConfiguration',
  'ListBuckets', 'ListObjectsV2', 'ListMultipartUploads', 'ListParts',
  'AbortMultipartUpload', 'PutBucketCors', 'PutBucketLogging',
])
const CLASS_B_ACTIONS = new Set([
  'GetObject', 'HeadObject', 'HeadBucket',
  'GetBucketEncryption', 'GetBucketLifecycleConfiguration',
  'GetBucketCors', 'GetBucketLogging', 'GetBucketLocation',
])

// ── Estado ───────────────────────────────────────────────────────────────────
let timer: NodeJS.Timeout | null = null
let lastTickAt: Date | null = null
let lastReport: { bucket: string; driftPct: number; status: string }[] = []

// ── GraphQL helpers ──────────────────────────────────────────────────────────

interface StorageRow {
  bucketName: string
  payloadSize: number
  objectCount: number
}
interface OperationsRow {
  bucketName: string
  actionType: string
  actionStatus: string
  requests: number
}

async function fetchR2Storage(periodStart: Date, periodEnd: Date): Promise<StorageRow[]> {
  const query = `query R2Storage($accountTag: String!, $from: Time!, $to: Time!) {
    viewer { accounts(filter: {accountTag: $accountTag}) {
      r2StorageAdaptiveGroups(filter: {datetime_geq: $from, datetime_leq: $to}, limit: 1000, orderBy: [datetime_DESC]) {
        max { payloadSize objectCount }
        dimensions { bucketName }
      }
    } }
  }`
  const r = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      variables: { accountTag: ACCOUNT_ID, from: periodStart.toISOString(), to: periodEnd.toISOString() },
    }),
  })
  const json = await r.json() as {
    data?: { viewer?: { accounts?: { r2StorageAdaptiveGroups?: { max: { payloadSize: number; objectCount: number }; dimensions: { bucketName: string } }[] }[] } }
    errors?: { message: string }[]
  }
  if (json.errors) throw new Error(`GraphQL storage: ${JSON.stringify(json.errors)}`)
  const rows = json.data?.viewer?.accounts?.[0]?.r2StorageAdaptiveGroups ?? []
  // Pega o MÁXIMO observado por bucket (snapshot de pico no período)
  const byBucket = new Map<string, StorageRow>()
  for (const r of rows) {
    const cur = byBucket.get(r.dimensions.bucketName)
    if (!cur || r.max.payloadSize > cur.payloadSize) {
      byBucket.set(r.dimensions.bucketName, {
        bucketName:  r.dimensions.bucketName,
        payloadSize: r.max.payloadSize,
        objectCount: r.max.objectCount,
      })
    }
  }
  return [...byBucket.values()]
}

async function fetchR2Operations(periodStart: Date, periodEnd: Date): Promise<OperationsRow[]> {
  const query = `query R2Ops($accountTag: String!, $from: Time!, $to: Time!) {
    viewer { accounts(filter: {accountTag: $accountTag}) {
      r2OperationsAdaptiveGroups(filter: {datetime_geq: $from, datetime_leq: $to}, limit: 5000) {
        sum { requests }
        dimensions { bucketName actionType actionStatus }
      }
    } }
  }`
  const r = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      variables: { accountTag: ACCOUNT_ID, from: periodStart.toISOString(), to: periodEnd.toISOString() },
    }),
  })
  const json = await r.json() as {
    data?: { viewer?: { accounts?: { r2OperationsAdaptiveGroups?: { sum: { requests: number }; dimensions: { bucketName: string; actionType: string; actionStatus: string } }[] }[] } }
    errors?: { message: string }[]
  }
  if (json.errors) throw new Error(`GraphQL operations: ${JSON.stringify(json.errors)}`)
  const rows = json.data?.viewer?.accounts?.[0]?.r2OperationsAdaptiveGroups ?? []
  return rows.map(r => ({
    bucketName:   r.dimensions.bucketName,
    actionType:   r.dimensions.actionType,
    actionStatus: r.dimensions.actionStatus,
    requests:     r.sum.requests,
  }))
}

// ── Reconciliação ────────────────────────────────────────────────────────────

interface ReconciledBucket {
  bucketName:    string
  cfStorageBytes: number
  cfClassAOps:   number
  cfClassBOps:   number
}

async function reconcileSnapshots(): Promise<void> {
  if (!ACCOUNT_ID || !API_TOKEN) {
    logger.info('storage_billing_reconcile_noop_missing_config')
    return
  }

  // Pega snapshots do mês corrente que ainda estão preliminares
  const now    = new Date()
  const start  = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0))
  const end    = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0))

  // Busca dados Cloudflare via GraphQL (1 chamada storage + 1 ops)
  let storageRows: StorageRow[]
  let opsRows:     OperationsRow[]
  try {
    [storageRows, opsRows] = await Promise.all([
      fetchR2Storage(start, end),
      fetchR2Operations(start, end),
    ])
  } catch (err) {
    logger.warn({ err }, 'storage_billing_reconcile_graphql_failed')
    return
  }

  // Agrega ops por bucket → Class A / B
  const opsByBucket = new Map<string, { classA: number; classB: number }>()
  for (const r of opsRows) {
    if (r.actionStatus !== 'success') continue   // só conta operações bem-sucedidas
    const cur = opsByBucket.get(r.bucketName) ?? { classA: 0, classB: 0 }
    if (CLASS_A_ACTIONS.has(r.actionType))      cur.classA += r.requests
    else if (CLASS_B_ACTIONS.has(r.actionType)) cur.classB += r.requests
    opsByBucket.set(r.bucketName, cur)
  }

  // Indexa storage por nome
  const cfData: Record<string, ReconciledBucket> = {}
  for (const s of storageRows) {
    const ops = opsByBucket.get(s.bucketName) ?? { classA: 0, classB: 0 }
    cfData[s.bucketName] = {
      bucketName:    s.bucketName,
      cfStorageBytes: s.payloadSize,
      cfClassAOps:   ops.classA,
      cfClassBOps:   ops.classB,
    }
  }

  // Pega snapshots locais
  const yearMonth = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`
  const snapshots = await prisma.storageBillingSnapshot.findMany({
    where: { periodYearMonth: yearMonth },
    include: { bucket: { select: { name: true } } },
  })

  const report: typeof lastReport = []
  for (const snap of snapshots) {
    const cf = cfData[snap.bucket.name]
    if (!cf) {
      report.push({ bucket: snap.bucket.name, driftPct: 0, status: 'no_cf_data' })
      continue
    }

    const localBytes = Number(snap.avgStorageBytes)
    const driftPct = cf.cfStorageBytes > 0
      ? ((localBytes - cf.cfStorageBytes) / cf.cfStorageBytes) * 100
      : 0

    // Atualiza snapshot com dados CF como fonte autoritativa
    await prisma.storageBillingSnapshot.update({
      where: { id: snap.id },
      data: {
        // Usa números CF como autoritativo
        avgStorageBytes:        BigInt(cf.cfStorageBytes),
        classAOpsTotal:         BigInt(cf.cfClassAOps),
        classBOpsTotal:         BigInt(cf.cfClassBOps),
        // Marca drift mesmo sem fatura final
        reconciliationDriftPct: Number(driftPct.toFixed(2)),
        reconciledAt:           new Date(),
        ...(snap.status === 'CLOSED' ? { status: 'RECONCILED' as const } : {}),
      },
    })

    const driftAbs = Math.abs(driftPct)
    if (driftAbs > ALERT_PCT) {
      logger.warn({
        bucket:      snap.bucket.name,
        localBytes,
        cfBytes:     cf.cfStorageBytes,
        driftPct:    driftPct.toFixed(2),
        cfClassAOps: cf.cfClassAOps,
        cfClassBOps: cf.cfClassBOps,
      }, 'storage_billing_reconcile_drift_alert')
      report.push({ bucket: snap.bucket.name, driftPct, status: 'drift_alert' })
    } else {
      report.push({ bucket: snap.bucket.name, driftPct, status: 'ok' })
    }
  }

  lastTickAt = new Date()
  lastReport = report
  logger.info({ buckets: snapshots.length, alertThresholdPct: ALERT_PCT }, 'storage_billing_reconcile_complete')
}

// ── API pública ──────────────────────────────────────────────────────────────

export const storageBillingReconciliation = {
  start(): void {
    if (!ENABLED) {
      logger.info('storage_billing_reconcile_disabled')
      return
    }
    if (!ACCOUNT_ID || !API_TOKEN) {
      logger.info({ hasAccount: !!ACCOUNT_ID, hasToken: !!API_TOKEN }, 'storage_billing_reconcile_noop_missing_config')
      return
    }
    if (timer) return
    logger.info({ tickMs: TICK_MS, alertPct: ALERT_PCT }, 'storage_billing_reconcile_starting')
    timer = setInterval(() => {
      reconcileSnapshots().catch(err => logger.error({ err }, 'storage_billing_reconcile_unhandled'))
    }, TICK_MS)
  },

  stop(): void {
    if (timer) { clearInterval(timer); timer = null }
  },

  /** Força tick imediato. */
  async runOnce(): Promise<void> { await reconcileSnapshots() },

  status() {
    return { enabled: ENABLED, running: !!timer, lastTickAt, lastReport }
  },
}
