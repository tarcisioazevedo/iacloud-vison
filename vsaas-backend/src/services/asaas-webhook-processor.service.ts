/**
 * Asaas Webhook Processor
 *
 * Processa eventos PENDING da tabela AsaasWebhookEvent.
 * Roda em loop a cada POLL_MS segundos.
 *
 * Mapeamento de eventos:
 *   PAYMENT_OVERDUE                    → suspende ClienteSubscriptions do integrador inadimplente
 *   PAYMENT_RECEIVED/CONFIRMED         → reativa ClienteSubscriptions SUSPENDED
 *   SUBSCRIPTION_DELETED/CANCELLED     → inicia período de graça nas subscriptions ativas
 *   PAYMENT_AWAITING_RISK_ANALYSIS     → Invoice.status='RISK_PENDING' (cartão em análise)
 *   PAYMENT_APPROVED_BY_RISK_ANALYSIS  → Invoice.status='PENDING' (cartão aprovado)
 *   PAYMENT_REPROVED_BY_RISK_ANALYSIS  → Invoice.status='RISK_DENIED' + email integrador
 *   PAYMENT_REFUNDED                   → Invoice.status='REFUNDED' (estorno total)
 *   PAYMENT_PARTIALLY_REFUNDED         → Invoice.status='PARTIALLY_REFUNDED'
 *   PAYMENT_DELETED                    → Invoice.status='CANCELLED'
 *   PAYMENT_RESTORED                   → Invoice.status='PENDING' (revert delete)
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

// Nomes de eventos Asaas que este processor conhece (com ação)
const EVENTS_OVERDUE       = ['PAYMENT_OVERDUE']
const EVENTS_PAID          = ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED']
// SUBSCRIPTION_CANCELLED não existe em Asaas v3 — nomes reais: DELETED, INACTIVATED
const EVENTS_CANCELLED     = ['SUBSCRIPTION_DELETED', 'SUBSCRIPTION_INACTIVATED']
const EVENTS_RISK_PENDING  = ['PAYMENT_AWAITING_RISK_ANALYSIS']
const EVENTS_RISK_APPROVED = ['PAYMENT_APPROVED_BY_RISK_ANALYSIS']
const EVENTS_RISK_DENIED   = ['PAYMENT_REPROVED_BY_RISK_ANALYSIS']
const EVENTS_REFUNDED      = ['PAYMENT_REFUNDED']
const EVENTS_PART_REFUNDED = ['PAYMENT_PARTIALLY_REFUNDED']
const EVENTS_DELETED       = ['PAYMENT_DELETED']
const EVENTS_RESTORED      = ['PAYMENT_RESTORED']
const EVENTS_REFUND_DENIED = ['PAYMENT_REFUND_DENIED']
const EVENTS_CHARGEBACK    = [
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE',
  'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
]
const EVENTS_BALANCE_BLOCK   = ['BALANCE_VALUE_BLOCKED']
const EVENTS_BALANCE_UNBLOCK = ['BALANCE_VALUE_UNBLOCKED']
const EVENTS_ACCOUNT_CRITICAL = [
  'ACCOUNT_STATUS_GENERAL_APPROVAL_REJECTED',
  'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_REJECTED',
  'ACCOUNT_STATUS_COMMERCIAL_INFO_REJECTED',
  'ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRED',
  'ACCOUNT_STATUS_DOCUMENT_REJECTED',
]
const EVENTS_ACCOUNT_INFO = [
  // Aprovações/análises — apenas log info, sem alerta
  'ACCOUNT_STATUS_GENERAL_APPROVAL_APPROVED',
  'ACCOUNT_STATUS_GENERAL_APPROVAL_AWAITING_APPROVAL',
  'ACCOUNT_STATUS_GENERAL_APPROVAL_PENDING',
  'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_APPROVED',
  'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_AWAITING_APPROVAL',
  'ACCOUNT_STATUS_BANK_ACCOUNT_INFO_PENDING',
  'ACCOUNT_STATUS_COMMERCIAL_INFO_APPROVED',
  'ACCOUNT_STATUS_COMMERCIAL_INFO_AWAITING_APPROVAL',
  'ACCOUNT_STATUS_COMMERCIAL_INFO_EXPIRING_SOON',
  'ACCOUNT_STATUS_COMMERCIAL_INFO_PENDING',
  'ACCOUNT_STATUS_DOCUMENT_APPROVED',
  'ACCOUNT_STATUS_DOCUMENT_AWAITING_APPROVAL',
  'ACCOUNT_STATUS_DOCUMENT_PENDING',
]

// Valores aceitos no campo Invoice.status (string livre — ainda não enum Prisma)
type InvoiceStatus =
  | 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELLED'
  | 'REFUNDED' | 'PARTIALLY_REFUNDED'
  | 'RISK_PENDING' | 'RISK_DENIED'

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

/** Extrai o asaasPaymentId (pay_xxx) do payload. */
function extractPaymentId(payload: any): string | null {
  return payload?.payment?.id ?? payload?.id ?? null
}

/**
 * Atualiza Invoice pelo asaasPaymentId. Retorna a invoice ou null se não achou
 * (caso típico: cobrança avulsa não atrelada a um Invoice interno).
 */
async function updateInvoiceStatus(
  payload: any,
  newStatus: InvoiceStatus,
): Promise<{ id: string; integradorId: string } | null> {
  const payId = extractPaymentId(payload)
  if (!payId) return null
  const inv = await prisma.invoice.findUnique({
    where:  { asaasPaymentId: payId },
    select: { id: true, integradorId: true },
  })
  if (!inv) return null
  await prisma.invoice.update({
    where: { id: inv.id },
    data:  { status: newStatus, ...(newStatus === 'PAID' ? { paidAt: new Date() } : {}) },
  })
  return inv
}

// ─── handlers ────────────────────────────────────────────────────────────────

async function handleOverdue(event: { id: string; payloadJson: any }): Promise<void> {
  const payload = event.payloadJson
  const asaasSubId = extractSubscriptionId(payload)
  const extRef     = extractExternalRef(payload)

  // Marca Invoice como OVERDUE (se existir associação por asaasPaymentId)
  await updateInvoiceStatus(payload, 'OVERDUE')

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

  // 1) Atualiza Invoice (se atrelada por asaasPaymentId) — marca PAID + paidAt
  const invoice = await updateInvoiceStatus(payload, 'PAID')

  // 2) Cria PaymentReceipt (idempotente por webhookEventId)
  if (invoice) {
    const payId       = extractPaymentId(payload)
    const amount      = Number(payload?.payment?.value ?? payload?.value ?? 0)
    const billingType = payload?.payment?.billingType ?? payload?.billingType ?? 'UNDEFINED'
    const paidAtRaw   = payload?.payment?.confirmedDate
                     ?? payload?.payment?.paymentDate
                     ?? payload?.payment?.creditDate
                     ?? new Date().toISOString()
    try {
      await prisma.paymentReceipt.create({
        data: {
          invoiceId:       invoice.id,
          integradorId:    invoice.integradorId,
          asaasPaymentId:  payId ?? '',
          amountBrl:       amount,
          billingType,
          paidAt:          new Date(paidAtRaw),
          webhookEventId:  event.id,
          rawPayload:      payload,
        },
      })
    } catch (err: any) {
      // P2002 unique violation = duplicado (webhook retentou). Ignora.
      if (err?.code !== 'P2002') {
        logger.warn({ err, invoiceId: invoice.id }, 'asaas_payment_receipt_insert_failed')
      }
    }
  }

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

/**
 * PAYMENT_AWAITING_RISK_ANALYSIS — cartão em análise de risco anti-fraude.
 * Não suspende serviço (transação ainda pode ser aprovada).
 */
async function handleRiskPending(event: { id: string; payloadJson: any }): Promise<void> {
  const inv = await updateInvoiceStatus(event.payloadJson, 'RISK_PENDING')
  logger.info(
    { eventId: event.id, invoiceId: inv?.id, integradorId: inv?.integradorId },
    'asaas_payment_risk_pending',
  )
}

/**
 * PAYMENT_APPROVED_BY_RISK_ANALYSIS — análise aprovou o cartão.
 * Volta status ao fluxo normal (PENDING até confirmação do payment).
 */
async function handleRiskApproved(event: { id: string; payloadJson: any }): Promise<void> {
  const inv = await updateInvoiceStatus(event.payloadJson, 'PENDING')
  logger.info(
    { eventId: event.id, invoiceId: inv?.id, integradorId: inv?.integradorId },
    'asaas_payment_risk_approved',
  )
}

/**
 * PAYMENT_REPROVED_BY_RISK_ANALYSIS — cartão recusado. Cobrança não vai prosseguir
 * por este meio. Marca invoice como RISK_DENIED e notifica o integrador
 * (cobrança pendente, ele precisa atualizar cartão ou trocar meio).
 */
async function handleRiskDenied(event: { id: string; payloadJson: any }): Promise<void> {
  const inv = await updateInvoiceStatus(event.payloadJson, 'RISK_DENIED')
  if (!inv) return

  logger.warn(
    { eventId: event.id, invoiceId: inv.id, integradorId: inv.integradorId },
    'asaas_payment_risk_denied',
  )

  // Email para o integrador (não pro CF — é cobrança ao integrador)
  const integ = await prisma.integrador.findUnique({
    where:  { id: inv.integradorId },
    select: { name: true, users: { select: { email: true }, take: 1 } },
  })
  const email = integ?.users?.[0]?.email
  if (!email) return
  sendMail({
    to: email,
    subject: 'Cartão recusado pela análise anti-fraude — iaCloud Vision',
    text: 'Sua cobrança não foi aprovada pela análise de risco. Atualize o método de pagamento.',
    html: `
      <p>Olá, ${integ?.name ?? 'integrador'},</p>
      <p>Identificamos que o cartão usado em sua última cobrança foi
         <strong>recusado pela análise anti-fraude</strong>.</p>
      <p>Por favor, atualize o método de pagamento no painel para evitar
         interrupção do serviço.</p>
      <p>— Equipe iaCloud Vision</p>
    `,
  }).catch((err: Error) => logger.warn({ err, integradorId: inv.integradorId }, 'asaas_risk_denied_email_failed'))
}

/**
 * PAYMENT_REFUNDED — cobrança totalmente estornada (acordo entre fabricante e
 * integrador). NÃO suspende serviço — refund foi voluntário.
 */
async function handleRefunded(event: { id: string; payloadJson: any }): Promise<void> {
  const inv = await updateInvoiceStatus(event.payloadJson, 'REFUNDED')
  logger.info(
    { eventId: event.id, invoiceId: inv?.id, integradorId: inv?.integradorId },
    'asaas_payment_refunded',
  )
}

/**
 * PAYMENT_PARTIALLY_REFUNDED — refund parcial. Mantém serviço ativo.
 * O contábil precisa lançar a diferença manualmente (Asaas guarda histórico).
 */
async function handlePartiallyRefunded(event: { id: string; payloadJson: any }): Promise<void> {
  const inv = await updateInvoiceStatus(event.payloadJson, 'PARTIALLY_REFUNDED')
  logger.info(
    { eventId: event.id, invoiceId: inv?.id, integradorId: inv?.integradorId },
    'asaas_payment_partially_refunded',
  )
}

/**
 * PAYMENT_DELETED — cobrança removida (geralmente operação manual no painel).
 * Marca como CANCELLED. Não toca em subscriptions — esse evento é só do payment.
 */
async function handlePaymentDeleted(event: { id: string; payloadJson: any }): Promise<void> {
  const inv = await updateInvoiceStatus(event.payloadJson, 'CANCELLED')
  logger.info(
    { eventId: event.id, invoiceId: inv?.id, integradorId: inv?.integradorId },
    'asaas_payment_deleted',
  )
}

/**
 * PAYMENT_RESTORED — cobrança que tinha sido deletada foi restaurada.
 * Reverte CANCELLED → PENDING.
 */
async function handlePaymentRestored(event: { id: string; payloadJson: any }): Promise<void> {
  const inv = await updateInvoiceStatus(event.payloadJson, 'PENDING')
  logger.info(
    { eventId: event.id, invoiceId: inv?.id, integradorId: inv?.integradorId },
    'asaas_payment_restored',
  )
}

// ─── handlers críticos (alertam fabricante via email) ────────────────────────

const FABRICANTE_ALERT_EMAIL =
  process.env.FABRICANTE_ALERT_EMAIL ?? 'falecomtarcisio@gmail.com'

/**
 * Helper para alertas críticos enviados ao admin do fabricante (não ao integrador).
 * Usado em eventos de saúde da conta Asaas e disputas de chargeback.
 */
async function alertFabricante(
  subject: string,
  bodyHtml: string,
  bodyText: string,
): Promise<void> {
  try {
    await sendMail({
      to:      FABRICANTE_ALERT_EMAIL,
      subject: `[Asaas] ${subject}`,
      text:    bodyText,
      html:    bodyHtml,
    })
  } catch (err) {
    logger.warn({ err }, 'asaas_alert_fabricante_email_failed')
  }
}

/**
 * PAYMENT_REFUND_DENIED — Asaas negou o estorno (saldo insuficiente, prazo, etc).
 * Não toca em status — só loga e alerta admin pra revisar manualmente.
 */
async function handleRefundDenied(event: { id: string; payloadJson: any }): Promise<void> {
  const payId = extractPaymentId(event.payloadJson)
  logger.warn({ eventId: event.id, payId }, 'asaas_payment_refund_denied')
  await alertFabricante(
    'Estorno negado',
    `<p>O Asaas negou o estorno da cobrança <strong>${payId ?? '?'}</strong>.</p>
     <p>Possíveis motivos: prazo excedido, saldo insuficiente, transação já contestada.</p>
     <p>Verificar no painel Asaas e processar manualmente se necessário.</p>`,
    `Estorno do payment ${payId} foi negado pelo Asaas. Verificar painel.`,
  )
}

/**
 * Chargeback flow — cliente abriu disputa no cartão. Pode resultar em perda
 * do valor + multa. Apenas notifica — defesa da disputa é manual.
 */
async function handleChargeback(event: { id: string; payloadJson: any }): Promise<void> {
  const evt   = event.payloadJson?.event ?? '?'
  const payId = extractPaymentId(event.payloadJson)
  const value = event.payloadJson?.payment?.value ?? '?'

  logger.warn({ eventId: event.id, evt, payId, value }, 'asaas_payment_chargeback')

  const stage = evt === 'PAYMENT_CHARGEBACK_REQUESTED' ? 'aberta'
              : evt === 'PAYMENT_CHARGEBACK_DISPUTE'   ? 'em disputa'
              : 'aguardando reversão'

  await alertFabricante(
    `Chargeback ${stage}`,
    `<p>Cliente abriu disputa de chargeback na cobrança <strong>${payId ?? '?'}</strong>
       (valor R$ ${value}).</p>
     <p>Estado: <strong>${stage}</strong>.</p>
     <p>Acessar painel Asaas → Disputas e contestar com documentos dentro do prazo
       para evitar perda do valor.</p>`,
    `Chargeback ${stage}: payment=${payId} value=R$${value}. Defender no painel.`,
  )
}

/**
 * BALANCE_VALUE_BLOCKED — saldo da conta Asaas bloqueado (ordem judicial,
 * suspeita de fraude, penhora, etc). CRÍTICO — pode afetar saída de caixa.
 */
async function handleBalanceBlocked(event: { id: string; payloadJson: any }): Promise<void> {
  const value = event.payloadJson?.value ?? event.payloadJson?.amount ?? '?'
  const reason = event.payloadJson?.reason ?? event.payloadJson?.description ?? 'não informado'

  logger.error({ eventId: event.id, value, reason }, 'asaas_balance_blocked')

  await alertFabricante(
    'SALDO BLOQUEADO — ação imediata',
    `<p><strong>O Asaas bloqueou saldo da conta.</strong></p>
     <p>Valor: R$ ${value}<br>Motivo: ${reason}</p>
     <p>Verificar painel Asaas imediatamente. Pode haver:</p>
     <ul>
       <li>Penhora judicial</li>
       <li>Suspeita de fraude</li>
       <li>Bloqueio cautelar (KYC pendente)</li>
     </ul>`,
    `[CRÍTICO] Asaas bloqueou R$${value}. Motivo: ${reason}. Verificar painel.`,
  )
}

/** BALANCE_VALUE_UNBLOCKED — saldo liberado. Notifica admin (informativo). */
async function handleBalanceUnblocked(event: { id: string; payloadJson: any }): Promise<void> {
  const value = event.payloadJson?.value ?? event.payloadJson?.amount ?? '?'
  logger.info({ eventId: event.id, value }, 'asaas_balance_unblocked')
  await alertFabricante(
    'Saldo liberado',
    `<p>Saldo de R$ ${value} foi desbloqueado pelo Asaas.</p>`,
    `Saldo R$${value} foi desbloqueado pelo Asaas.`,
  )
}

/**
 * ACCOUNT_STATUS_*_REJECTED / EXPIRED — conta Asaas com problema de aprovação.
 * Sem isso resolvido, billing para. CRÍTICO.
 */
async function handleAccountCritical(event: { id: string; payloadJson: any }): Promise<void> {
  const evt = event.payloadJson?.event ?? '?'
  logger.error({ eventId: event.id, evt }, 'asaas_account_status_critical')

  const what = evt.includes('GENERAL')    ? 'aprovação geral'
             : evt.includes('BANK')       ? 'conta bancária'
             : evt.includes('COMMERCIAL') ? 'informações comerciais'
             : evt.includes('DOCUMENT')   ? 'documentos'
             : evt
  const state = evt.includes('REJECTED') ? 'reprovada'
              : evt.includes('EXPIRED')  ? 'expirada'
              : 'com problema'

  await alertFabricante(
    `Conta Asaas — ${what} ${state}`,
    `<p><strong>O Asaas marcou a sua conta como ${state}</strong> no quesito <em>${what}</em>.</p>
     <p>Evento: <code>${evt}</code></p>
     <p>Enquanto não resolver no painel Asaas, novas cobranças podem ser bloqueadas
       e saldo pode ficar retido.</p>`,
    `[CRÍTICO] Conta Asaas: ${what} ${state}. Resolver no painel pra desbloquear billing.`,
  )
}

/** ACCOUNT_STATUS_* informativo (APPROVED/PENDING/AWAITING) — apenas log. */
async function handleAccountInfo(event: { id: string; payloadJson: any }): Promise<void> {
  const evt = event.payloadJson?.event ?? '?'
  logger.info({ eventId: event.id, evt }, 'asaas_account_status_info')
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
  // Processa TODOS os PENDING — eventos sem handler dedicado são marcados
  // PROCESSED com log "asaas_event_no_handler" pra não acumular órfãos.
  const events = await prisma.asaasWebhookEvent.findMany({
    where:   { status: 'PENDING' },
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
      } else if (EVENTS_RISK_PENDING.includes(event.eventName)) {
        await handleRiskPending(event)
      } else if (EVENTS_RISK_APPROVED.includes(event.eventName)) {
        await handleRiskApproved(event)
      } else if (EVENTS_RISK_DENIED.includes(event.eventName)) {
        await handleRiskDenied(event)
      } else if (EVENTS_REFUNDED.includes(event.eventName)) {
        await handleRefunded(event)
      } else if (EVENTS_PART_REFUNDED.includes(event.eventName)) {
        await handlePartiallyRefunded(event)
      } else if (EVENTS_DELETED.includes(event.eventName)) {
        await handlePaymentDeleted(event)
      } else if (EVENTS_RESTORED.includes(event.eventName)) {
        await handlePaymentRestored(event)
      } else if (EVENTS_REFUND_DENIED.includes(event.eventName)) {
        await handleRefundDenied(event)
      } else if (EVENTS_CHARGEBACK.includes(event.eventName)) {
        await handleChargeback(event)
      } else if (EVENTS_BALANCE_BLOCK.includes(event.eventName)) {
        await handleBalanceBlocked(event)
      } else if (EVENTS_BALANCE_UNBLOCK.includes(event.eventName)) {
        await handleBalanceUnblocked(event)
      } else if (EVENTS_ACCOUNT_CRITICAL.includes(event.eventName)) {
        await handleAccountCritical(event)
      } else if (EVENTS_ACCOUNT_INFO.includes(event.eventName)) {
        await handleAccountInfo(event)
      } else {
        // Evento sem handler dedicado (ex: PAYMENT_BANK_SLIP_VIEWED, PAYMENT_AUTHORIZED).
        // Marca PROCESSED sem ação pra não acumular órfão em PENDING. Log info pra
        // permitir adicionar handler depois se virar relevante.
        logger.info(
          { eventId: event.id, eventName: event.eventName },
          'asaas_event_no_handler',
        )
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

// Exportação apenas para tests unitários (`*.spec.ts`).
// Não usar em código de produção — chamar handlers através do processBatch.
export const __testables__ = {
  handleOverdue,
  handlePaid,
  handleCancelled,
  handleRiskPending,
  handleRiskApproved,
  handleRiskDenied,
  handleRefunded,
  handlePartiallyRefunded,
  handlePaymentDeleted,
  handlePaymentRestored,
  handleRefundDenied,
  handleChargeback,
  handleBalanceBlocked,
  handleBalanceUnblocked,
  handleAccountCritical,
  handleAccountInfo,
  updateInvoiceStatus,
  extractSubscriptionId,
  extractExternalRef,
  extractPaymentId,
}
