/**
 * Admin billing — SUPER_ADMIN.
 * Mutações reais só funcionam quando BILLING_ENABLED=true.
 */
import { Router } from 'express'
import { prisma } from '../lib/prisma'
import { requireRole } from '../middleware/auth'
import { isBillingEnabled, BillingDisabledError } from '../services/asaas.service'

const router = Router()
router.use(requireRole('SUPER_ADMIN', 'ADMIN_GLOBAL'))

router.get('/status', async (_req, res) => {
  const enabled = isBillingEnabled()
  const hasKey = !!process.env.ASAAS_API_KEY
  const hasSecret = !!process.env.ASAAS_WEBHOOK_SECRET
  const baseUrl = process.env.ASAAS_BASE_URL ?? 'https://sandbox.asaas.com/api/v3'
  const isSandbox = baseUrl.includes('sandbox')

  const [customerCount, subCount, recentWebhooks] = await Promise.all([
    prisma.asaasCustomer.count(),
    prisma.asaasSubscription.count({ where: { status: 'ACTIVE' } }),
    prisma.asaasWebhookEvent.findMany({
      take: 5,
      orderBy: { receivedAt: 'desc' },
      select: { eventId: true, eventName: true, status: true, receivedAt: true },
    }),
  ])

  res.json({
    enabled, provisioned: true,
    config: {
      hasApiKey: hasKey, hasWebhookSecret: hasSecret,
      baseUrl, isSandbox,
      flag: process.env.BILLING_ENABLED ?? 'false',
    },
    counts: { customers: customerCount, activeSubscriptions: subCount },
    recentWebhooks,
    notes: enabled
      ? null
      : 'Billing está provisionado mas inativo. Configure ASAAS_API_KEY + ASAAS_WEBHOOK_SECRET e defina BILLING_ENABLED=true.',
  })
})

router.get('/customers', async (_req, res) => {
  res.json(await prisma.asaasCustomer.findMany({
    include: { integrador: { select: { id: true, name: true, tradeName: true, email: true } } },
    orderBy: { createdAt: 'desc' },
  }))
})

router.get('/subscriptions', async (_req, res) => {
  res.json(await prisma.asaasSubscription.findMany({
    include: { integrador: { select: { id: true, name: true, tradeName: true } } },
    orderBy: { nextDueDate: 'asc' },
  }))
})

router.get('/webhooks', async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 200)
  const status = typeof req.query.status === 'string' ? String(req.query.status) : ''
  const where = status ? { status } : {}
  res.json(await prisma.asaasWebhookEvent.findMany({
    where, take: limit, orderBy: { receivedAt: 'desc' },
  }))
})

router.post('/test-create-customer', async (_req, res) => {
  if (!isBillingEnabled()) {
    return res.status(503).json({ error: 'billing_disabled', message: new BillingDisabledError().message })
  }
  res.json({ ok: true, message: 'Billing está ativo. Implementação real do create-customer pendente.' })
})

export default router
