/**
 * me-integrador-asaas.ts — onboarding e gestão da assinatura do integrador
 * no Asaas (cobrança que o fabricante faz do integrador).
 *
 *   GET    /me/integrador/asaas/status          → estado atual (customer + subscription)
 *   POST   /me/integrador/asaas/setup           → cria customer + subscription
 *   DELETE /me/integrador/asaas/subscription    → cancela subscription (mantém customer)
 *
 * Gating: todas as rotas verificam isBillingEnabled(). Quando off, retornam
 * 503 com body { error: 'billing_disabled' } — frontend mostra banner
 * "Billing em provisionamento" sem quebrar UI.
 *
 * Idempotência:
 *   - setup chamado 2× retorna o estado existente sem criar duplicata
 *   - cancel chamado 2× é no-op (idempotente no Asaas também)
 */
import { Router } from 'express'
import { publicRoute } from '../middleware/require-capability'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { ValidationError, ForbiddenError } from '../lib/errors'
import {
  isBillingEnabled,
  BillingDisabledError,
  AsaasApiError,
  createCustomer,
  createSubscription,
  cancelSubscription,
} from '../services/asaas.service'

export const meIntegradorAsaasRouter = Router()
meIntegradorAsaasRouter.use(requireAuth)

function assertIntegradorAdmin(role?: string, integradorId?: string): string {
  if (!integradorId) throw new ForbiddenError('Apenas integradores podem gerenciar billing')
  if (!['INTEGRADOR_ADMIN', 'SUPER_ADMIN', 'ADMIN_GLOBAL'].includes(role ?? '')) {
    throw new ForbiddenError('Apenas INTEGRADOR_ADMIN pode gerenciar billing')
  }
  return integradorId
}

function billingGate(res: import('express').Response): boolean {
  if (isBillingEnabled()) return false
  res.status(503).json({
    error: 'billing_disabled',
    message: 'Billing está provisionado mas inativo. Aguardando ativação pelo fabricante.',
  })
  return true
}

// CPF (11 dígitos) ou CNPJ (14 dígitos) — só dígitos, sem máscara
const CpfCnpjSchema = z.string()
  .transform(s => s.replace(/\D/g, ''))
  .refine(s => s.length === 11 || s.length === 14, 'CPF (11) ou CNPJ (14) inválido')

const SetupSchema = z.object({
  cpfCnpj:     CpfCnpjSchema,
  email:       z.string().email().optional(),
  phone:       z.string().optional(),
  planSlug:    z.string().min(1, 'planSlug obrigatório'),
  value:       z.number().positive('value deve ser > 0'),
  cycle:       z.enum(['MONTHLY', 'YEARLY']).default('MONTHLY'),
  billingType: z.enum(['BOLETO', 'CREDIT_CARD', 'PIX', 'UNDEFINED']).default('UNDEFINED'),
})

// ── GET /me/integrador/asaas/status ──────────────────────────────────────────

meIntegradorAsaasRouter.get('/status',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const { role, integradorId } = req.jwtPayload!
    const integId = assertIntegradorAdmin(role, integradorId)

    const [customer, subscription] = await Promise.all([
      prisma.asaasCustomer.findUnique({ where: { integradorId: integId } }),
      prisma.asaasSubscription.findFirst({
        where:   { integradorId: integId, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    res.json({
      billingEnabled: isBillingEnabled(),
      customer: customer
        ? { id: customer.asaasCustomerId, syncedAt: customer.syncedAt }
        : null,
      subscription: subscription
        ? {
            id:           subscription.asaasSubscriptionId,
            planSlug:     subscription.planSlug,
            cycle:        subscription.cycle,
            value:        Number(subscription.value),
            status:       subscription.status,
            nextDueDate:  subscription.nextDueDate,
            billingType:  subscription.billingType,
          }
        : null,
    })
  }),
)

// ── POST /me/integrador/asaas/setup ──────────────────────────────────────────

meIntegradorAsaasRouter.post('/setup',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const { role, integradorId } = req.jwtPayload!
    const integId = assertIntegradorAdmin(role, integradorId)
    if (billingGate(res)) return

    const parsed = SetupSchema.safeParse(req.body)
    if (!parsed.success) {
      throw new ValidationError('Payload inválido', { details: parsed.error.flatten() })
    }
    const input = parsed.data

    const integrador = await prisma.integrador.findUnique({
      where:  { id: integId },
      select: { id: true, name: true, tradeName: true, email: true, cnpj: true, phone: true },
    })
    if (!integrador) throw new ValidationError('Integrador não encontrado')

    // 1) Customer — idempotente
    let asaasCustomer = await prisma.asaasCustomer.findUnique({
      where: { integradorId: integId },
    })

    if (!asaasCustomer) {
      try {
        const created = await createCustomer({
          name:              integrador.tradeName ?? integrador.name,
          cpfCnpj:           input.cpfCnpj,
          email:             input.email ?? integrador.email,
          phone:             input.phone ?? integrador.phone ?? undefined,
          externalReference: integId,
        })
        asaasCustomer = await prisma.asaasCustomer.create({
          data: {
            integradorId:    integId,
            asaasCustomerId: created.id,
            cpfCnpj:         input.cpfCnpj,
            email:           input.email ?? integrador.email,
            phone:           input.phone ?? integrador.phone ?? null,
          },
        })
        logger.info({ integradorId: integId, asaasCustomerId: created.id }, 'asaas_customer_created')
      } catch (err: any) {
        if (err instanceof BillingDisabledError) {
          return res.status(503).json({ error: 'billing_disabled', message: err.message })
        }
        if (err instanceof AsaasApiError) {
          logger.warn({ status: err.status, errors: err.errors, integradorId: integId }, 'asaas_create_customer_rejected')
          return res.status(400).json({
            error:  'asaas_rejected_customer',
            status: err.status,
            errors: err.errors,
          })
        }
        logger.error({ err, integradorId: integId }, 'asaas_create_customer_failed')
        throw new ValidationError(`Falha ao criar customer no Asaas: ${err?.message ?? 'unknown'}`)
      }
    }

    // 2) Subscription — só uma ativa por vez
    const existing = await prisma.asaasSubscription.findFirst({
      where:   { integradorId: integId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    })

    if (existing) {
      return res.json({
        idempotent: true,
        customer:     { id: asaasCustomer.asaasCustomerId },
        subscription: {
          id:          existing.asaasSubscriptionId,
          planSlug:    existing.planSlug,
          cycle:       existing.cycle,
          value:       Number(existing.value),
          status:      existing.status,
          nextDueDate: existing.nextDueDate,
          billingType: existing.billingType,
        },
      })
    }

    // dueDate: primeira cobrança em D+7 (dá tempo do integrador ver email)
    const nextDueDate = new Date()
    nextDueDate.setDate(nextDueDate.getDate() + 7)

    try {
      const created = await createSubscription({
        customer:          asaasCustomer.asaasCustomerId,
        billingType:       input.billingType,
        value:             input.value,
        nextDueDate:       nextDueDate.toISOString().slice(0, 10),
        cycle:             input.cycle,
        description:       `iaCloud Vision — plano ${input.planSlug}`,
        externalReference: integId,
      })
      const saved = await prisma.asaasSubscription.create({
        data: {
          integradorId:        integId,
          asaasSubscriptionId: created.id,
          planSlug:            input.planSlug,
          cycle:               input.cycle,
          value:               input.value,
          nextDueDate,
          status:              'ACTIVE',
          billingType:         input.billingType,
          externalReference:   integId,
        },
      })
      logger.info(
        { integradorId: integId, asaasSubscriptionId: created.id, value: input.value },
        'asaas_subscription_created',
      )
      res.status(201).json({
        idempotent: false,
        customer:     { id: asaasCustomer.asaasCustomerId },
        subscription: {
          id:          saved.asaasSubscriptionId,
          planSlug:    saved.planSlug,
          cycle:       saved.cycle,
          value:       Number(saved.value),
          status:      saved.status,
          nextDueDate: saved.nextDueDate,
          billingType: saved.billingType,
        },
      })
    } catch (err: any) {
      if (err instanceof BillingDisabledError) {
        return res.status(503).json({ error: 'billing_disabled', message: err.message })
      }
      if (err instanceof AsaasApiError) {
        logger.warn({ status: err.status, errors: err.errors, integradorId: integId }, 'asaas_create_subscription_rejected')
        return res.status(400).json({
          error:  'asaas_rejected_subscription',
          status: err.status,
          errors: err.errors,
        })
      }
      logger.error({ err, integradorId: integId }, 'asaas_create_subscription_failed')
      throw new ValidationError(`Falha ao criar subscription no Asaas: ${err?.message ?? 'unknown'}`)
    }
  }),
)

// ── DELETE /me/integrador/asaas/subscription ─────────────────────────────────

meIntegradorAsaasRouter.delete('/subscription',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const { role, integradorId } = req.jwtPayload!
    const integId = assertIntegradorAdmin(role, integradorId)
    if (billingGate(res)) return

    const sub = await prisma.asaasSubscription.findFirst({
      where:   { integradorId: integId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    })
    if (!sub) {
      return res.json({ idempotent: true, message: 'Nenhuma subscription ativa pra cancelar' })
    }

    try {
      await cancelSubscription(sub.asaasSubscriptionId)
    } catch (err: any) {
      if (err instanceof BillingDisabledError) {
        return res.status(503).json({ error: 'billing_disabled', message: err.message })
      }
      if (err instanceof AsaasApiError) {
        logger.warn(
          { status: err.status, errors: err.errors, integradorId: integId },
          'asaas_cancel_subscription_rejected',
        )
        return res.status(400).json({
          error:  'asaas_rejected_cancel',
          status: err.status,
          errors: err.errors,
        })
      }
      logger.error(
        { err, integradorId: integId, asaasSubscriptionId: sub.asaasSubscriptionId },
        'asaas_cancel_subscription_failed',
      )
      throw new ValidationError(`Falha ao cancelar no Asaas: ${err?.message ?? 'unknown'}`)
    }

    await prisma.asaasSubscription.update({
      where: { id: sub.id },
      data:  { status: 'INACTIVE', cancelledAt: new Date() },
    })

    logger.info(
      { integradorId: integId, asaasSubscriptionId: sub.asaasSubscriptionId },
      'asaas_subscription_cancelled',
    )
    res.json({ ok: true, cancelledId: sub.asaasSubscriptionId })
  }),
)
