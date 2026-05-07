/**
 * R2 Event Consumer — polleia uma Cloudflare Queue HTTP pull e atualiza,
 * em tempo quase-real, `StorageBucket.totalBytes/objectCount` e a tabela
 * `StorageUsage` (breakdown por cliente/câmera).
 *
 * Por que existe (Sprint 1, decisão de arquitetura validada no Sprint 0):
 *   Sem este consumer, a única forma de medir consumo é `ListObjectsV2`
 *   recursivo (custoso em Class B ops). Event Notifications da Cloudflare
 *   entregam delta em ~segundos — base para painel de billing e alertas
 *   de quota.
 *
 * Robustez:
 *   - O cron `storage-reconciliation` (semanal) corrige drift causado
 *     por mensagens perdidas, retries ou consumer offline.
 *   - Sem R2_QUEUE_ID configurado, o consumer fica em modo no-op.
 *   - Falha de rede / 5xx → skip do tick (sem ack), próximo tick reprocessa.
 *
 * Schema do evento (validado em Sprint 0, evidência s0.4-pull-messages-3.json):
 *   {
 *     account, bucket, eventTime, action,
 *     object: { key, size, eTag }
 *   }
 *
 * Ações monitoradas:
 *   PutObject, CompleteMultipartUpload, CopyObject  → delta = +size
 *   DeleteObject, LifecycleDeletion                 → delta = -size (best-effort)
 *   AbortMultipartUpload                            → delta = 0
 *
 * Mapeamento de key → tenant (padrão arquitetural):
 *   c/{clienteFinalId}/{cameraId}/{rec|snap|evt}/...   → cliente + câmera
 *   c/{clienteFinalId}/exp/...                          → cliente, sem câmera
 *   _legal-hold/{caseId}/...  ou  _sys/...              → bucket-level apenas
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

// ── Configuração ─────────────────────────────────────────────────────────────
const ACCOUNT_ID  = process.env.R2_ACCOUNT_ID  ?? ''
const API_TOKEN   = process.env.R2_API_TOKEN   ?? ''
const QUEUE_ID    = process.env.R2_QUEUE_ID    ?? ''
const TICK_MS     = Number(process.env.R2_EVENT_CONSUMER_INTERVAL_MS ?? 30_000)
const BATCH_SIZE  = Number(process.env.R2_EVENT_CONSUMER_BATCH_SIZE  ?? 100)
const VISIBILITY_MS = 30_000   // mensagem fica invisível por 30s enquanto processamos
const ENABLED     = process.env.R2_EVENT_CONSUMER_DISABLED !== 'true'

const API_BASE = 'https://api.cloudflare.com/client/v4'

// ── Tipos ────────────────────────────────────────────────────────────────────
type R2Action =
  | 'PutObject' | 'CompleteMultipartUpload' | 'CopyObject'
  | 'DeleteObject' | 'LifecycleDeletion'
  | 'AbortMultipartUpload'

interface R2EventBody {
  account:  string
  bucket:   string
  eventTime: string
  action:   R2Action
  object:   { key: string; size?: number; eTag?: string }
}

interface QueueMessage {
  id: string
  timestamp_ms: number
  body: string                  // JSON stringified R2EventBody
  attempts: number
  metadata: Record<string, string>
  lease_id: string
}

// ── Estado ───────────────────────────────────────────────────────────────────
let timer: NodeJS.Timeout | null = null
let lastTickAt: Date | null = null
let totalProcessed = 0
let totalFailed    = 0

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Mapeia o key R2 para (clienteFinalId, cameraId). Retorna nulls se não bate. */
function parseKey(key: string): { clienteFinalId: string | null; cameraId: string | null } {
  // Padrão "c/{cli}/{cam}/(rec|snap|evt)/..."
  const m = /^c\/([^/]+)\/([^/]+)\/(rec|snap|evt)\//.exec(key)
  if (m) return { clienteFinalId: m[1], cameraId: m[2] }
  // Padrão "c/{cli}/exp/..."
  const expM = /^c\/([^/]+)\/exp\//.exec(key)
  if (expM) return { clienteFinalId: expM[1], cameraId: null }
  // _legal-hold, _sys/, ou padrões antigos
  return { clienteFinalId: null, cameraId: null }
}

/** Calcula o delta de bytes/objectCount a partir da ação. */
function calculateDelta(ev: R2EventBody): { bytesDelta: number; countDelta: number } {
  const size = ev.object.size ?? 0
  switch (ev.action) {
    case 'PutObject':
    case 'CompleteMultipartUpload':
    case 'CopyObject':
      return { bytesDelta: +size, countDelta: +1 }
    case 'DeleteObject':
    case 'LifecycleDeletion':
      // Em delete, R2 nem sempre traz size — usar 0 quando ausente; reconciliation corrige drift.
      return { bytesDelta: -size, countDelta: -1 }
    case 'AbortMultipartUpload':
      return { bytesDelta: 0, countDelta: 0 }
    default:
      logger.warn({ action: ev.action, key: ev.object.key }, 'r2_event_unknown_action')
      return { bytesDelta: 0, countDelta: 0 }
  }
}

async function pullMessages(): Promise<QueueMessage[]> {
  const url = `${API_BASE}/accounts/${ACCOUNT_ID}/queues/${QUEUE_ID}/messages/pull`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ visibility_timeout_ms: VISIBILITY_MS, batch_size: BATCH_SIZE }),
  })
  if (!res.ok) {
    throw new Error(`pull HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
  const json = await res.json() as {
    success: boolean
    errors?: { message: string }[]
    result?: { messages?: QueueMessage[] }
  }
  if (!json.success) {
    throw new Error(`pull error: ${JSON.stringify(json.errors)}`)
  }
  return json.result?.messages ?? []
}

async function ackMessages(leaseIds: string[]): Promise<void> {
  if (leaseIds.length === 0) return
  const url = `${API_BASE}/accounts/${ACCOUNT_ID}/queues/${QUEUE_ID}/messages/ack`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ acks: leaseIds.map(id => ({ lease_id: id })) }),
  })
  if (!res.ok) {
    logger.warn({ status: res.status, count: leaseIds.length }, 'r2_event_ack_failed')
  }
}

/**
 * Processa 1 mensagem aplicando o delta no banco. Retorna true se ack deve
 * ser enviado (ie. processamento determinístico — sucesso OU falha permanente
 * que não vale a pena reprocessar, como bucket desconhecido).
 */
async function processMessage(msg: QueueMessage): Promise<boolean> {
  let ev: R2EventBody
  try {
    ev = JSON.parse(msg.body) as R2EventBody
  } catch {
    logger.error({ msgId: msg.id, body: msg.body.slice(0, 200) }, 'r2_event_invalid_json')
    return true   // ack: lixo permanente
  }

  // Resolve bucket → StorageBucket (1 query). Quando o bucket não está
  // registrado em StorageBucket (raro: setup incompleto), só logamos.
  const bucket = await prisma.storageBucket.findFirst({
    where: { name: ev.bucket, active: true },
    select: { id: true, integradorId: true },
  })
  if (!bucket) {
    logger.warn({ bucketName: ev.bucket, action: ev.action }, 'r2_event_bucket_not_registered')
    return true   // ack: não vamos reprocessar até o bucket aparecer
  }

  const { clienteFinalId, cameraId } = parseKey(ev.object.key)
  const { bytesDelta, countDelta }   = calculateDelta(ev)

  // Atualização atômica:
  //  1) StorageBucket: incrementa totais + atualiza lastEventTime
  //  2) StorageUsage: upsert por (bucket, cliente, camera, dia)
  await prisma.$transaction([
    prisma.storageBucket.update({
      where: { id: bucket.id },
      data: {
        totalBytes:    { increment: BigInt(bytesDelta) },
        objectCount:   { increment: countDelta },
        lastEventTime: new Date(ev.eventTime),
      },
    }),
    // Linha agregada do dia (recordedAt arredondado pra 00:00 UTC):
    // simplificação: sempre criamos uma linha nova; o Sprint 4 (billing snapshot)
    // agrega por mês. Pra evitar inflação aqui, só registramos quando há tenant.
    ...(clienteFinalId
      ? [
          prisma.storageUsage.create({
            data: {
              bucketId: bucket.id,
              clienteFinalId,
              cameraId,
              usedBytes: BigInt(bytesDelta),
              objectCount: countDelta,
            },
          }),
        ]
      : []),
  ])
  return true
}

async function tick(): Promise<void> {
  if (!ENABLED || !ACCOUNT_ID || !API_TOKEN || !QUEUE_ID) return

  let messages: QueueMessage[]
  try {
    messages = await pullMessages()
  } catch (err) {
    logger.warn({ err }, 'r2_event_pull_failed')
    return
  }

  if (messages.length === 0) {
    lastTickAt = new Date()
    return
  }

  const acks: string[] = []
  for (const msg of messages) {
    try {
      const shouldAck = await processMessage(msg)
      if (shouldAck) {
        acks.push(msg.lease_id)
        totalProcessed++
      } else {
        totalFailed++
      }
    } catch (err) {
      totalFailed++
      logger.error({ err, msgId: msg.id }, 'r2_event_process_failed')
      // sem ack — visibility timeout vai retornar a msg pra fila
    }
  }
  await ackMessages(acks)

  lastTickAt = new Date()
  logger.info({
    received:  messages.length,
    acked:     acks.length,
    cumulative: { processed: totalProcessed, failed: totalFailed },
  }, 'r2_event_tick')
}

// ── API pública ──────────────────────────────────────────────────────────────

export const r2EventConsumer = {
  start(): void {
    if (!ENABLED) {
      logger.info('r2_event_consumer_disabled')
      return
    }
    if (!ACCOUNT_ID || !API_TOKEN || !QUEUE_ID) {
      logger.info({
        hasAccount: !!ACCOUNT_ID,
        hasToken:   !!API_TOKEN,
        hasQueue:   !!QUEUE_ID,
      }, 'r2_event_consumer_noop_missing_config')
      return
    }
    if (timer) return
    logger.info({ tickMs: TICK_MS, batchSize: BATCH_SIZE }, 'r2_event_consumer_starting')
    timer = setInterval(() => {
      tick().catch(err => logger.error({ err }, 'r2_event_tick_unhandled'))
    }, TICK_MS)
  },

  stop(): void {
    if (timer) { clearInterval(timer); timer = null }
  },

  /** Para debug e healthcheck. */
  status() {
    return {
      enabled:       ENABLED,
      configured:    !!(ACCOUNT_ID && API_TOKEN && QUEUE_ID),
      running:       !!timer,
      lastTickAt,
      totalProcessed,
      totalFailed,
    }
  },
}
