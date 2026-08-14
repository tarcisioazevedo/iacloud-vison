/**
 * Subscription Trial service — trial em nível de ClienteSubscription.
 *
 * IMPORTANTE: este service é distinto do legado `trial.service.ts`, que cobre
 * o trial em nível de Integrador (Integrador.trialEndsAt). Aqui tratamos trial
 * por **produto contratado** pelo cliente final.
 *
 * Cascata de concessão (Fabricante → Integrador → Cliente):
 *   - SUPER_ADMIN / ADMIN_GLOBAL pode conceder pra qualquer cliente
 *   - INTEGRADOR_ADMIN pode conceder pra clientes do seu tenant
 *   - Cliente final pode iniciar self-service se product.allowSelfTrial=true
 *
 * Ciclo de vida:
 *   1. grantTrial() cria ClienteSubscription com status=TRIAL + trialUntil
 *   2. processExpiredTrials() (cron 1h) faz downgrade TRIAL → CANCELED
 *      quando trialUntil passou, invalida cache de capabilities
 *   3. convertTrialToActive() marca convertedToPaidAt e muda status pra ACTIVE
 *      (chamado quando o cliente assina o plano pago)
 *
 * Plano: docs/35-AUDIT-CONSISTENCIA-E2E.md (Trial System real).
 */
import type { ClienteSubscription } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { invalidateCapabilityCache } from '../lib/capability-check'

/**
 * Concede um trial pra um cliente final.
 *
 * Quem chama: SUPER_ADMIN / INTEGRADOR_ADMIN (com validação de tenant)
 * ou cliente final em self-service (rota separada valida allowSelfTrial).
 *
 * Throws:
 *   - 'product_not_found' se productId não existir
 *   - 'product_inactive' se produto não estiver ativo
 *   - 'already_has_subscription' se já tiver sub ACTIVE/TRIAL/GRACE/PENDING desse produto
 */
export async function grantTrial(opts: {
  clienteFinalId: string
  productId: string
  grantedByUserId: string
  campaign?: string
  customDurationDays?: number
  acceptedIp?: string | null
}): Promise<ClienteSubscription> {
  const product = await prisma.marketplaceProduct.findUnique({
    where: { id: opts.productId },
  })
  if (!product) throw new Error('product_not_found')
  if (!product.active) throw new Error('product_inactive')

  // Bloqueia duplicação: cliente não pode ter 2 subs do mesmo produto em paralelo
  const existing = await prisma.clienteSubscription.findFirst({
    where: {
      clienteFinalId: opts.clienteFinalId,
      productId: opts.productId,
      status: { in: ['ACTIVE', 'TRIAL', 'GRACE', 'PENDING'] },
    },
  })
  if (existing) throw new Error('already_has_subscription')

  const days = Math.max(1, opts.customDurationDays ?? product.trialDays)
  const now = new Date()
  const trialUntil = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)

  const sub = await prisma.clienteSubscription.create({
    data: {
      clienteFinalId:    opts.clienteFinalId,
      productId:         opts.productId,
      cameraIds:         [],
      status:            'TRIAL',
      startedAt:         now,
      // Trial não cobra — snapshot com 0
      basePriceUsd:      0,
      markupPct:         0,
      finalPriceBrl:     0,
      // Aceite formal — quem concede aceita os termos do trial
      acceptedTermsAt:   now,
      acceptedByUserId:  opts.grantedByUserId,
      acceptedIp:        opts.acceptedIp ?? null,
      productConfig:     (product.trialConfig ?? product.metadata) ?? undefined,
      trialUntil,
      trialGrantedBy:    opts.grantedByUserId,
      trialFromCampaign: opts.campaign ?? null,
      trialDays:         days,
    },
  })

  // Invalida cache pra UI refletir capability nova na hora
  await invalidateCapabilityCache(opts.clienteFinalId).catch(() => {})

  logger.info({
    subscriptionId:  sub.id,
    clienteFinalId:  opts.clienteFinalId,
    productId:       opts.productId,
    grantedBy:       opts.grantedByUserId,
    trialUntil:      trialUntil.toISOString(),
    days,
    campaign:        opts.campaign ?? null,
  }, 'subscription_trial_granted')

  return sub
}

/**
 * Converte um trial em assinatura paga (cliente concordou em assinar).
 * Mantém o registro pra analytics de funil (convertedToPaidAt).
 *
 * Throws 'not_trial' se a sub não estiver em TRIAL.
 */
export async function convertTrialToActive(opts: {
  subscriptionId: string
  basePriceUsd: number
  markupPct: number
  finalPriceBrl: number
}): Promise<ClienteSubscription> {
  const sub = await prisma.clienteSubscription.findUnique({
    where: { id: opts.subscriptionId },
  })
  if (!sub) throw new Error('subscription_not_found')
  if (sub.status !== 'TRIAL') throw new Error('not_trial')

  const now = new Date()
  const updated = await prisma.clienteSubscription.update({
    where: { id: sub.id },
    data: {
      status:            'ACTIVE',
      basePriceUsd:      opts.basePriceUsd,
      markupPct:         opts.markupPct,
      finalPriceBrl:     opts.finalPriceBrl,
      convertedToPaidAt: now,
    },
  })

  await invalidateCapabilityCache(sub.clienteFinalId).catch(() => {})

  logger.info({
    subscriptionId: sub.id,
    clienteFinalId: sub.clienteFinalId,
    productId:      sub.productId,
  }, 'subscription_trial_converted_to_paid')

  return updated
}

/**
 * Calcula dias restantes (>= 0) pro trial mais "fresco" do cliente.
 * Retorna null se não houver trial ativo.
 */
export async function trialDaysLeftForCliente(
  clienteFinalId: string,
): Promise<number | null> {
  const trial = await prisma.clienteSubscription.findFirst({
    where: { clienteFinalId, status: 'TRIAL', trialUntil: { not: null } },
    orderBy: { trialUntil: 'asc' }, // o que vai vencer primeiro
    select: { trialUntil: true },
  })
  if (!trial?.trialUntil) return null
  const ms = trial.trialUntil.getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)))
}

/**
 * Cron que roda 1×/hora.
 *  - TRIAL com trialUntil <= now → status=CANCELED + cancelReason='trial_expired'
 *  - Invalida capability cache do cliente afetado
 *  - Retorna contadores pra logging/observability
 *
 * Lembretes (1, 3, 7 dias antes) ficam como TODO: depende de SMTP do integrador
 * ou push do cliente. Logamos pra dashboard saber qual deveria ter notificado.
 */
export async function processExpiredTrials(): Promise<{
  expired: number
  warned: number
  warnings: Array<{ daysLeft: number; count: number }>
}> {
  const now = new Date()

  // ── 1) Expirados ───────────────────────────────────────────────────────
  const expired = await prisma.clienteSubscription.findMany({
    where: {
      status: 'TRIAL',
      trialUntil: { lte: now, not: null },
    },
    select: { id: true, clienteFinalId: true, productId: true, trialUntil: true },
  })

  for (const sub of expired) {
    try {
      await prisma.clienteSubscription.update({
        where: { id: sub.id },
        data: {
          status:       'CANCELED',
          canceledAt:   now,
          cancelReason: 'trial_expired',
        },
      })
      await invalidateCapabilityCache(sub.clienteFinalId).catch(() => {})
      logger.info({
        subscriptionId: sub.id,
        clienteFinalId: sub.clienteFinalId,
        productId:      sub.productId,
        trialUntil:     sub.trialUntil?.toISOString(),
      }, 'subscription_trial_expired')
    } catch (err) {
      logger.warn({ err, subscriptionId: sub.id }, 'subscription_trial_expire_failed')
    }
  }

  // ── 2) Lembretes (1, 3, 7 dias antes) ──────────────────────────────────
  // Estratégia: janela de 1h centrada no instante alvo. Cron de 1h passa
  // 1x por janela, então cada sub é "lembrada" uma única vez por estágio.
  // TODO: integrar envio real (e-mail/WA) quando o SMTP do integrador estiver
  // configurado — hoje só logamos pra dashboard ver.
  const stages = [1, 3, 7] as const
  const warnings: Array<{ daysLeft: number; count: number }> = []
  let warnedTotal = 0

  for (const days of stages) {
    const target    = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
    const windowEnd = target
    const windowStart = new Date(target.getTime() - 60 * 60 * 1000) // 1h antes

    const sample = await prisma.clienteSubscription.findMany({
      where: {
        status: 'TRIAL',
        trialUntil: { gte: windowStart, lte: windowEnd },
      },
      select: { id: true, clienteFinalId: true, productId: true, trialUntil: true },
    })

    for (const sub of sample) {
      logger.info({
        subscriptionId: sub.id,
        clienteFinalId: sub.clienteFinalId,
        productId:      sub.productId,
        daysLeft:       days,
        trialUntil:     sub.trialUntil?.toISOString(),
      }, 'subscription_trial_reminder_due')
    }
    warnings.push({ daysLeft: days, count: sample.length })
    warnedTotal += sample.length
  }

  logger.info({
    expired: expired.length,
    warned:  warnedTotal,
    warnings,
  }, 'trial_cron_processed')

  return { expired: expired.length, warned: warnedTotal, warnings }
}
