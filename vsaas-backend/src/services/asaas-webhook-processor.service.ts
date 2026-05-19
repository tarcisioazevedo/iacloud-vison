/**
 * Asaas Webhook Processor
 *
 * Processa eventos PENDING da tabela AsaasWebhookEvent.
 * Roda em loop a cada POLL_MS segundos.
 *
 * Mapeamento de eventos:
 *   PAYMENT_OVERDUE         → suspende ClienteSubscriptions do integrador inadimplente
 *   PAYMENT_RECEIVED/CONFIRMED → reativa ClienteSubscriptions SUSPENDED do integrador
 *   SUBSCRIPTION_DELETED    → inicia período de graça nas ClienteSubscriptions ativas
 *
 * Idempotência: cada evento é marcado PROCESSED ou FAILED após processamento.
 * Replay: basta redefinir status=PENDING para reprocessar.
 *
 * Quando BILLING_ENABLED=false: o loop roda mas não há eventos reais — no-op.
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { sendMail } from '../lib/smtp'

const POLL_MS = 30_000
const BATCH_SIZE = 20
const GRACE_DAYS_ON_CANCELLATION = 7

// Nomes de eventos Asaas que este processor conhece
const EVENTS_OVERDUE     = ['PAYMENT_OVERDUE']
const EVENTS_PAID        = ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED']
const EVENTS_CANCELLED   = ['SUBSCRIPTION_DELETED', 'SUBSCRIPTION_CANCELLED']
const HANDLED_EVENTS     = [...EVENTS_OVERDUE, ...EVENTS_PAID, ...EVENTS_CANCELLED]

// ─── helpers ────────────────────────────────────────────────────────────────

function graceUntil(): Date {
  const d = new Date()
  d.setDate(d.getDate() + GRACE_DAYS_ON_CANCELLATION)
  return d
}

/** Extrai o asaasSubscriptionId do payload bruto do Asaas. */
function extractSubscriptionId(payload: any): string | null {
  return (
    payload?.subscription?.id ??
    payload?.payment?.subscription ??
    payload?.subscriptionId ??
    null
  )
}

/** Extrai o externalReference do payload (pode apontar para integradorId). */
function extractExternalRef(payload: any): string | null {
  return (
    payload?.subscription?.externalReference ??
    payload?.payment?.externalReference ??
    null
  )
}

// ─── handlers ────────────────────────────────────────────────────────────────

async function handleOverdue(event: { id: string; payloadJson: any }): Promise<void> {
  const payload = event.payloadJson
  const asaasSubId = extractSubscriptionId(payload)
  const extRef     = extractExternalRef(payload)

  const integrador = await resolveIntegrador(asaasSubId, extRef)
  if (!integrador) {
    logger.warn({ eventId: event.id, asaasSubId, extRef }, 'asaas_processor_integrador_not_found_overdue')
    return
  }

  // Suspende todas as ClienteSubscriptions ACTIVE/GRACE do integrador
  const subs = await prisma.clienteSubscription.findMany({
    where: {
      status: { in: ['ACTIVE', 'GRACE'] },
      clienteFinal: { integradorId: integrador.id },
    },
    select: { id: true, clienteFinalId: true },
  })

  if (subs.length === 0) return

  await prisma.clienteSubscription.updateMany({
    where: { id: { in: subs.map(s => s.id) } },
    data:  { status: 'SUSPENDED', updatedAt: new Date() },
  })

  logger.warn(
    { integradorId: integrador.id, suspendedCount: subs.length },
    'asaas_subscriptions_suspended_overdue',
  )

  // Notifica CFs afetados (fire-and-forget)
  const cfIds = [...new Set(subs.map(s => s.clienteFinalId))]
  for (const cfId of cfIds) {
    const cf = await prisma.clienteFinal.findUnique({
      where: { id: cfId },
      select: { tradeName: true, name: true, users: { select: { email: true }, take: 1 } },
    }) as any
    const email = cf?.users[0]?.email
    if (!email) continue
    sendMail({
      to: email,
      subject: 'Serviço temporariamente suspenso — iaCloud Vision',
      text: 'Seu serviço foi temporariamente suspenso por pendência de pagamento. Entre em contato com seu integrador.',
      html: `
        <p>Olá, ${cf?.tradeName ?? cf?.name ?? 'cliente'},</p>
        <p>Identificamos um problema de pagamento no seu plano.
           Suas assinaturas foram <strong>temporariamente suspensas</strong>.</p>
        <p>Entre em contato com seu integrador para regularizar a situação.
           Seus dados estão seguros e serão restaurados assim que o pagamento for confirmado.</p>
        <p>— Equipe iaCloud Vision</p>
      `,
    }).catch((err: Error) => logger.warn({ err, cfId }, 'asaas_suspension_email_failed'))
  }
}

async function handlePaid(event: { id: string; payloadJson: any }): Promise<void> {
  const payload = event.payloadJson
  const asaasSubId = extractSubscriptionId(payload)
  const extRef     = extractExternalRef(payload)

  const integrador = await resolveIntegrador(asaasSubId, extRef)
  if (!integrador) {
    // Pode ser pagamento avulso não ligado a integrador — ignorar silenciosamente
    logger.debug({ eventId: event.id, asaasSubId, extRef }, 'asaas_processor_integrador_not_found_paid')
    return
  }

  const suspended = await prisma.clienteSubscription.findMany({
    where: {
      status: 'SUSPENDED',
      clienteFinal: { integradorId: integrador.id },
    },
    select: { id: true, clienteFinalId: true },
  })

  if (suspended.length === 0) return

  await prisma.clienteSubscription.updateMany({
    where: { id: { in: suspended.map(s => s.id) } },
    data: {
      status:        'ACTIVE',
      reactivatedAt: new Date(),
      updatedAt:     new Date(),
    },
  })

  logger.info(
    { integradorId: integrador.id, reactivatedCount: suspended.length },
    'asaas_subscriptions_reactivated_payment',
  )

  // Notifica CFs (fire-and-forget)
  const cfIds = [...new Set(suspended.map(s => s.clienteFinalId))]
  for (const cfId of cfIds) {
    const cf = await prisma.clienteFinal.findUnique({
      where: { id: cfId },
      select: { tradeName: true, name: true, users: { select: { email: true }, take: 1 } },
    }) as any
    const email = cf?.users[0]?.email
    if (!email) continue
    sendMail({
      to: email,
      subject: 'Serviço reativado — iaCloud Vision',
      text: 'Seu serviço foi reativado após confirmação do pagamento.',
      html: `
        <p>Olá, ${cf?.tradeName ?? cf?.name ?? 'cliente'},</p>
        <p>Ótimas notícias! O pagamento foi confirmado e suas assinaturas foram
           <strong>reativadas com sucesso</strong>.</p>
        <p>Suas câmeras voltam a gravar normalmente.</p>
        <p>— Equipe iaCloud Vision</p>
      `,
    }).catch((err: Error) => logger.warn({ err, cfId }, 'asaas_reactivation_email_failed'))
  }
}

async function handleCancelled(event: { id: string; payloadJson: any }): Promise<void> {
  const payload    = event.payloadJson
  const asaasSubId = extractSubscriptionId(payload)
  const extRef     = extractExternalRef(payload)

  const integrador = await resolveIntegrador(asaasSubId, extRef)
  if (!integrador) {
    logger.warn({ eventId: event.id, asaasSubId, extRef }, 'asaas_processor_integrador_not_found_cancelled')
    return
  }

  const active = await prisma.clienteSubscription.findMany({
    where: {
      status: { in: ['ACTIVE', 'SUSPENDED'] },
      clienteFinal: { integradorId: integrador.id },
    },
    select: { id: true },
  })

  if (active.length === 0) return

  const grace = graceUntil()
  await prisma.clienteSubscription.updateMany({
    where: { id: { in: active.map(s => s.id) } },
    data: {
      status:          'GRACE',
      canceledAt:      new Date(),
      cancelGraceUntil: grace,
      cancelReason:    'Assinatura do integrador cancelada no Asaas',
      updatedAt:       new Date(),
    },
  })

  logger.warn(
    { integradorId: integrador.id, graceCount: active.length, graceUntil: grace },
    'asaas_subscriptions_grace_on_cancellation',
  )
}

/** Resolve o Integrador a partir do asaasSubscriptionId ou externalReference. */
async function resolveIntegrador(
  asaasSubId: string | null,
  extRef: string | null,
): Promise<{ id: string } | null> {
  if (asaasSubId) {
    const sub = await prisma.asaasSubscription.findUnique({
      where:  { asaasSubscriptionId: asaasSubId },
      select: { integradorId: true },
    })
    if (sub) return { id: sub.integradorId }
  }
  if (extRef) {
    const integrador = await prisma.integrador.findFirst({
      where:  { id: extRef },
      select: { id: true },
    })
    if (integrador) return { id: integrador.id }
  }
  return null
}

// ─── processor loop ──────────────────────────────────────────────────────────

async function processBatch(): Promise<void> {
  const events = await prisma.asaasWebhookEvent.findMany({
    where:   { status: 'PENDING', eventName: { in: HANDLED_EVENTS } },
    orderBy: { receivedAt: 'asc' },
    take:    BATCH_SIZE,
  })

  if (events.length === 0) return

  logger.debug({ count: events.length }, 'asaas_processor_batch')

  for (const event of events) {
    try {
      if (EVENTS_OVERDUE.includes(event.eventName)) {
        await handleOverdue(event)
      } else if (EVENTS_PAID.includes(event.eventName)) {
        await handlePaid(event)
      } else if (EVENTS_CANCELLED.includes(event.eventName)) {
        await handleCancelled(event)
      }

      await prisma.asaasWebhookEvent.update({
        where: { id: event.id },
        data:  { status: 'PROCESSED', processedAt: new Date() },
      })
    } catch (err) {
      logger.error({ err, eventId: event.id, eventName: event.eventName }, 'asaas_processor_event_failed')
      await prisma.asaasWebhookEvent.update({
        where: { id: event.id },
        data:  { status: 'FAILED', errorMessage: String(err) },
      }).catch(() => {})
    }
  }
}

// ─── public API ──────────────────────────────────────────────────────────────

let _timer: ReturnType<typeof setInterval> | null = null

export const asaasWebhookProcessor = {
  /** Inicia o polling. Idempotente. */
  start(): void {
    if (_timer) return
    _timer = setInterval(() => {
      processBatch().catch(err => logger.error({ err }, 'asaas_processor_poll_error'))
    }, POLL_MS)
    // Processa imediatamente eventos que chegaram antes do start
    processBatch().catch(err => logger.error({ err }, 'asaas_processor_initial_error'))
    logger.info({ pollMs: POLL_MS }, 'asaas_webhook_processor_started')
  },

  /** Para o polling (graceful shutdown). */
  stop(): void {
    if (_timer) {
      clearInterval(_timer)
      _timer = null
    }
  },

  /** Trigger imediato (chamado pelo webhook handler após salvar evento). */
  triggerNow(): void {
    processBatch().catch(err => logger.error({ err }, 'asaas_processor_trigger_error'))
  },
}
