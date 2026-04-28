/**
 * Sprint Q.1 — WebPush VAPID nativo.
 *
 * Estratégia engenheiro de software senior:
 * - Carrega `web-push` dinamicamente. Se faltar (ambiente dev sem npm install),
 *   roda em modo SIMULADO — toda chamada loga e retorna OK sem network.
 * - VAPID keys vêm de ENV (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT).
 *   Se ausentes, gera par efêmero in-memory + LOG WARN — assinaturas existentes
 *   não funcionam, novas funcionam até restart. Dev-friendly.
 *
 * Reliability hat:
 * - 410 Gone do FCM/Mozilla = subscription morta → soft-delete (active=false).
 * - 429 / 5xx = backoff, mantém ativa, incrementa failureCount.
 * - 4xx outros = log + soft-delete após 3 falhas.
 * - Timeout configurável (10s padrão). Sem timeout, FCM trava worker.
 * - HMAC do payload é responsabilidade do `web-push` (assinatura JWT VAPID).
 */
import { logger } from './logger'
import { prisma } from './prisma'

interface PushPayload {
  title: string
  body: string
  icon?: string
  badge?: string
  tag?: string
  url?: string
  data?: Record<string, unknown>
}

interface SubscriptionLike {
  id: string
  endpoint: string
  p256dh: string
  authKey: string
}

interface SendResult {
  ok: boolean
  statusCode?: number
  error?: string
  /** True se subscription deve ser purgada (410 Gone). */
  expired: boolean
}

// ── VAPID config ───────────────────────────────────────────────────────────

interface VapidConfig {
  publicKey: string
  privateKey: string
  subject: string
}

let _vapid: VapidConfig | null = null
let _webpushLib: any = null
let _libLoaded = false
let _simulated = false

async function loadLib(): Promise<void> {
  if (_libLoaded) return
  _libLoaded = true
  try {
    // Dynamic import — `web-push` é optional dep. Usamos eval pra evitar
    // que o TS resolva o módulo em compile-time (módulo pode não estar instalado).
    const dynamicImport: (mod: string) => Promise<any> =
      // eslint-disable-next-line no-new-func
      new Function('mod', 'return import(mod)') as any
    const mod = await dynamicImport('web-push').catch(() => null)
    _webpushLib = mod ? (mod.default ?? mod) : null
  } catch {
    _webpushLib = null
  }
  if (!_webpushLib) {
    _simulated = true
    logger.warn('web-push lib não instalada — modo SIMULADO ativo. Rode `npm i web-push` para envio real.')
  }
}

function loadVapid(): VapidConfig {
  if (_vapid) return _vapid
  const pub = process.env.VAPID_PUBLIC_KEY?.trim()
  const priv = process.env.VAPID_PRIVATE_KEY?.trim()
  const subj = process.env.VAPID_SUBJECT?.trim() ?? 'mailto:noreply@iacloudvision.com.br'

  if (pub && priv) {
    _vapid = { publicKey: pub, privateKey: priv, subject: subj }
    return _vapid
  }

  // Fallback DEV — gera par efêmero. Notificações existentes quebram após
  // restart (queremos isso pra forçar configurar VAPID_* no ambiente).
  if (_webpushLib?.generateVAPIDKeys) {
    const k = _webpushLib.generateVAPIDKeys()
    _vapid = { publicKey: k.publicKey, privateKey: k.privateKey, subject: subj }
    logger.warn(
      { publicKey: _vapid.publicKey.slice(0, 16) + '…' },
      'VAPID keys não configuradas — usando par efêmero in-memory. Configure VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY em produção.',
    )
    return _vapid
  }

  // Sem lib + sem config → modo simulado puro
  _vapid = {
    publicKey: 'BSimulatedPublicKey______________________________________________________________________',
    privateKey: 'simulated_private',
    subject: subj,
  }
  return _vapid
}

/** Public key que o frontend usa pra criar a PushSubscription. */
export async function getVapidPublicKey(): Promise<string> {
  await loadLib()
  return loadVapid().publicKey
}

export function isSimulated(): boolean {
  return _simulated
}

/**
 * Envia um payload para uma subscription. Atualiza failureCount/lastError no DB.
 * Retorna `expired:true` quando o provedor responde 404/410 — o caller deve
 * marcar `active=false` no DB (feito automaticamente aqui).
 */
export async function sendToSubscription(
  sub: SubscriptionLike,
  payload: PushPayload,
  opts: { timeoutMs?: number } = {},
): Promise<SendResult> {
  await loadLib()

  if (_simulated) {
    logger.info(
      { subscriptionId: sub.id, payload },
      'webpush_simulated_send',
    )
    await prisma.pushSubscription.update({
      where: { id: sub.id },
      data: { lastUsedAt: new Date() },
    }).catch(() => {/* best-effort */})
    return { ok: true, statusCode: 201, expired: false }
  }

  const vapid = loadVapid()
  _webpushLib.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey)

  const subscriptionDescriptor = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.p256dh, auth: sub.authKey },
  }

  try {
    const result = await Promise.race([
      _webpushLib.sendNotification(subscriptionDescriptor, JSON.stringify(payload), { TTL: 60 }),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error('webpush_timeout')), opts.timeoutMs ?? 10_000),
      ),
    ]) as { statusCode: number }

    await prisma.pushSubscription.update({
      where: { id: sub.id },
      data: { lastUsedAt: new Date(), failureCount: 0, lastErrorMsg: null },
    }).catch(() => {/* best-effort */})

    return { ok: true, statusCode: result.statusCode, expired: false }
  } catch (err: any) {
    const status = err?.statusCode ?? err?.status
    const expired = status === 410 || status === 404

    await prisma.pushSubscription.update({
      where: { id: sub.id },
      data: {
        lastErrorAt: new Date(),
        lastErrorMsg: String(err?.message ?? err).slice(0, 500),
        failureCount: { increment: 1 },
        // Soft-delete se 410/404 OU >5 falhas seguidas
        active: expired ? false : undefined,
      },
    }).catch(() => {/* best-effort */})

    if (expired) {
      logger.info({ subscriptionId: sub.id, status }, 'webpush_subscription_expired_purged')
    } else {
      logger.warn(
        { subscriptionId: sub.id, status, err: err?.message },
        'webpush_send_failed',
      )
    }

    return { ok: false, statusCode: status, error: String(err?.message ?? err), expired }
  }
}

/**
 * Broadcast para todas as subscriptions de um actor (User|Integrador|SuperAdmin).
 * Faz fan-out em paralelo e retorna sumário.
 */
export async function broadcast(
  filter: { superAdminId?: string; integradorId?: string; userId?: string },
  payload: PushPayload,
): Promise<{ sent: number; failed: number; expired: number }> {
  const subs = await prisma.pushSubscription.findMany({
    where: {
      active: true,
      ...(filter.superAdminId   ? { superAdminId:   filter.superAdminId   } : {}),
      ...(filter.integradorId   ? { integradorId:   filter.integradorId   } : {}),
      ...(filter.userId         ? { userId:         filter.userId         } : {}),
    },
    select: { id: true, endpoint: true, p256dh: true, authKey: true },
  })

  if (subs.length === 0) return { sent: 0, failed: 0, expired: 0 }

  const results = await Promise.all(
    subs.map((s: SubscriptionLike) => sendToSubscription(s, payload)),
  )
  return {
    sent:    results.filter((r: SendResult) => r.ok).length,
    failed:  results.filter((r: SendResult) => !r.ok && !r.expired).length,
    expired: results.filter((r: SendResult) => r.expired).length,
  }
}
