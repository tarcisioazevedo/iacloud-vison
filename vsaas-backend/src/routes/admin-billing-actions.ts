/**
 * admin-billing-actions.ts — endpoints de ação operacional sobre billing.
 * SUPER_ADMIN / ADMIN_GLOBAL apenas.
 *
 *   GET    /admin/billing/overview                              → estado consolidado
 *   POST   /admin/billing/webhook-events/:id/reprocess          → volta FAILED → PENDING + trigger worker
 *   POST   /admin/billing/webhook-events/reprocess-all-failed   → bulk reprocess (7d)
 *   POST   /admin/billing/asaas/unpause-queue                   → reativa fila Asaas
 *   POST   /admin/billing/asaas/simulate-webhook                → posta payload mock em /webhooks/asaas
 *   DELETE /admin/billing/subscriptions/:id                     → cancela AsaasSubscription
 *   GET    /admin/billing/audit-log                             → histórico de rotações
 */
import { Router } from 'express'
import { publicRoute } from '../middleware/require-capability'
import { z } from 'zod'
import axios from 'axios'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { requireAuth, requireRole } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { ValidationError, NotFoundError } from '../lib/errors'
import { getBillingOverview, invalidateOverviewCache } from '../services/asaas-billing-overview.service'
import { getAsaasConfig } from '../services/asaas-config.service'
import { asaasWebhookProcessor } from '../services/asaas-webhook-processor.service'
import { cancelSubscription as cancelAsaasSubscription, AsaasApiError } from '../services/asaas.service'
import { invoiceGenerator } from '../services/invoice-generator.service'
import { tickBillingNotifications } from '../services/billing-notification.service'

export const adminBillingActionsRouter = Router()
adminBillingActionsRouter.use(requireAuth)
adminBillingActionsRouter.use(requireRole('SUPER_ADMIN', 'ADMIN_GLOBAL'))

// ── GET /admin/billing/overview ──────────────────────────────────────────────

adminBillingActionsRouter.get('/overview',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const force = req.query.refresh === 'true'
    const data = await getBillingOverview({ forceReload: force })
    res.json(data)
  }),
)

// ── POST /admin/billing/webhook-events/:id/reprocess ─────────────────────────

adminBillingActionsRouter.post('/webhook-events/:id/reprocess',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const evt = await prisma.asaasWebhookEvent.findUnique({ where: { id: req.params.id } })
    if (!evt) throw new NotFoundError('Webhook event não encontrado')
    if (evt.status === 'PROCESSED') {
      return res.status(409).json({ error: 'already_processed', message: 'Evento já foi processado com sucesso.' })
    }

    await prisma.asaasWebhookEvent.update({
      where: { id: evt.id },
      data:  { status: 'PENDING', errorMessage: null, processedAt: null },
    })
    asaasWebhookProcessor.triggerNow()
    invalidateOverviewCache()

    logger.info({
      eventId: evt.eventId, eventName: evt.eventName, actorUserId: req.jwtPayload?.sub,
    }, 'admin_asaas_event_reprocessed')

    res.json({ ok: true, status: 'PENDING' })
  }),
)

// ── POST /admin/billing/webhook-events/reprocess-all-failed ──────────────────

adminBillingActionsRouter.post('/webhook-events/reprocess-all-failed',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const since = new Date(Date.now() - 7 * 24 * 3600_000)
    const r = await prisma.asaasWebhookEvent.updateMany({
      where: { status: 'FAILED', receivedAt: { gte: since } },
      data:  { status: 'PENDING', errorMessage: null, processedAt: null },
    })
    asaasWebhookProcessor.triggerNow()
    invalidateOverviewCache()

    logger.info({ count: r.count, actorUserId: req.jwtPayload?.sub }, 'admin_asaas_bulk_reprocess')
    res.json({ ok: true, count: r.count })
  }),
)

// ── POST /admin/billing/asaas/unpause-queue ──────────────────────────────────

adminBillingActionsRouter.post('/asaas/unpause-queue',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const cfg = await getAsaasConfig()
    if (!cfg.apiKey) throw new ValidationError('Asaas não configurado')
    const baseURL = cfg.environment === 'SANDBOX'
      ? 'https://api-sandbox.asaas.com/v3'
      : 'https://api.asaas.com/v3'

    // 1) listar pra pegar o id do webhook
    let webhookId: string | null = null
    try {
      const list = await axios.get<{ data: Array<{ id: string }> }>(`${baseURL}/webhooks`, {
        headers: { access_token: cfg.apiKey, 'User-Agent': 'IACloudVision/1.0-admin' },
        timeout: 5_000,
      })
      webhookId = list.data?.data?.[0]?.id ?? null
    } catch (err) {
      logger.error({ err }, 'admin_asaas_unpause_list_failed')
      throw new ValidationError('Falha ao listar webhooks no Asaas')
    }

    if (!webhookId) {
      throw new NotFoundError('Nenhum webhook configurado no Asaas')
    }

    // 2) PUT com interrupted:false
    try {
      await axios.put(`${baseURL}/webhooks/${webhookId}`, { interrupted: false }, {
        headers: {
          access_token:   cfg.apiKey,
          'Content-Type': 'application/json',
          'User-Agent':   'IACloudVision/1.0-admin',
        },
        timeout: 5_000,
      })
    } catch (err: any) {
      const errs = err.response?.data?.errors
      logger.error({ err, errs }, 'admin_asaas_unpause_failed')
      throw new ValidationError(`Falha ao reativar fila: ${errs?.[0]?.description ?? err.message}`)
    }

    invalidateOverviewCache()
    logger.info({ webhookId, actorUserId: req.jwtPayload?.sub }, 'admin_asaas_webhook_queue_unpaused')
    res.json({ ok: true, webhookId })
  }),
)

// ── POST /admin/billing/asaas/simulate-webhook ───────────────────────────────

const SimulateSchema = z.object({
  eventName: z.string().min(3),
  paymentId: z.string().optional(),
  value:     z.number().optional(),
})

adminBillingActionsRouter.post('/asaas/simulate-webhook',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const parsed = SimulateSchema.safeParse(req.body)
    if (!parsed.success) throw new ValidationError('Payload inválido', { details: parsed.error.flatten() })

    const cfg = await getAsaasConfig()
    if (!cfg.webhookSecret) throw new ValidationError('Webhook secret não configurado')

    // Posta direto no nosso próprio /webhooks/asaas via localhost (loopback whitelisted)
    const payload = {
      id:    `simulated_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      event: parsed.data.eventName,
      payment: {
        id:                  parsed.data.paymentId ?? `pay_simulated_${Date.now()}`,
        value:               parsed.data.value ?? 0,
        status:              parsed.data.eventName.replace('PAYMENT_', ''),
        externalReference:   null,
      },
    }

    try {
      const r = await axios.post('http://localhost:3000/webhooks/asaas', payload, {
        headers: {
          'asaas-access-token': cfg.webhookSecret,
          'Content-Type':       'application/json',
          'User-Agent':         'IACloudVision/1.0-simulate',
        },
        timeout: 5_000,
      })
      invalidateOverviewCache()
      logger.info({
        eventName: parsed.data.eventName, simulatedId: payload.id, actorUserId: req.jwtPayload?.sub,
      }, 'admin_asaas_webhook_simulated')
      res.json({ ok: true, simulatedEventId: payload.id, backendResponse: r.data })
    } catch (err: any) {
      logger.warn({ err, status: err.response?.status }, 'admin_asaas_simulate_failed')
      res.status(500).json({ ok: false, error: err.response?.data ?? err.message })
    }
  }),
)

// ── DELETE /admin/billing/subscriptions/:id ──────────────────────────────────

adminBillingActionsRouter.delete('/subscriptions/:id',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const sub = await prisma.asaasSubscription.findUnique({ where: { id: req.params.id } })
    if (!sub) throw new NotFoundError('Subscription não encontrada')
    if (sub.status !== 'ACTIVE') {
      return res.status(409).json({ error: 'not_active', message: 'Subscription já não está ACTIVE.' })
    }

    try {
      await cancelAsaasSubscription(sub.asaasSubscriptionId)
    } catch (err: any) {
      if (err instanceof AsaasApiError) {
        logger.warn({ errors: err.errors, subId: sub.id }, 'admin_asaas_cancel_rejected')
        return res.status(400).json({ error: 'asaas_rejected', errors: err.errors })
      }
      logger.error({ err, subId: sub.id }, 'admin_asaas_cancel_failed')
      throw err
    }

    await prisma.asaasSubscription.update({
      where: { id: sub.id },
      data:  { status: 'INACTIVE', cancelledAt: new Date() },
    })

    invalidateOverviewCache()
    logger.info({
      subId: sub.id, asaasSubscriptionId: sub.asaasSubscriptionId, actorUserId: req.jwtPayload?.sub,
    }, 'admin_asaas_subscription_cancelled')

    res.json({ ok: true, cancelledId: sub.asaasSubscriptionId })
  }),
)

// ── GET /admin/billing/integradores-overview ────────────────────────────────
// Visão consolidada por integrador: MRR previsto, último pagamento, status

adminBillingActionsRouter.get('/integradores-overview',
  publicRoute(),
  asyncHandler(async (_req, res) => {
    const integs = await prisma.integrador.findMany({
      where:  { active: true },
      select: { id: true, name: true, tradeName: true },
    })

    const rows = await Promise.all(integs.map(async integ => {
      const [pending, lastPaid, customer, currentInv, preview] = await Promise.all([
        prisma.invoice.count({
          where:  { integradorId: integ.id, status: { in: ['PENDING', 'OVERDUE'] } },
        }),
        prisma.invoice.findFirst({
          where:   { integradorId: integ.id, status: 'PAID' },
          orderBy: { paidAt: 'desc' },
          select:  { totalAmountBrl: true, paidAt: true },
        }),
        prisma.asaasCustomer.findUnique({ where: { integradorId: integ.id } }),
        prisma.invoice.findFirst({
          where:   { integradorId: integ.id, status: { in: ['PENDING', 'OVERDUE'] } },
          orderBy: { dueDate: 'asc' },
          select:  { id: true, totalAmountBrl: true, dueDate: true, status: true, asaasPaymentUrl: true },
        }),
        // Quanto vai cobrar este mês (preview real-time)
        invoiceGenerator.preview(integ.id).catch(() => ({ totalBrl: 0, lines: [] })),
      ])

      return {
        integradorId:    integ.id,
        integradorName:  integ.tradeName ?? integ.name,
        hasAsaasCustomer: !!customer,
        pendingCount:    pending,
        previewMrrBrl:   preview.totalBrl,
        previewLines:    preview.lines.length,
        lastPaidAmount:  lastPaid ? Number(lastPaid.totalAmountBrl) : null,
        lastPaidAt:      lastPaid?.paidAt ?? null,
        currentInvoice:  currentInv ? {
          ...currentInv,
          totalAmountBrl: Number(currentInv.totalAmountBrl),
        } : null,
      }
    }))

    // Agregados pra header
    const totals = {
      mrrForecast:  rows.reduce((s, r) => s + (r.previewMrrBrl ?? 0), 0),
      overdueCount: rows.filter(r => (r.currentInvoice?.status === 'OVERDUE')).length,
      pendingCount: rows.reduce((s, r) => s + r.pendingCount, 0),
    }

    res.json({ totals, integradores: rows })
  }),
)

// ── POST /admin/billing/invoices/run-now ────────────────────────────────────
// Admin override — força geração de fatura imediata (default: todos os integradores)

adminBillingActionsRouter.post('/invoices/run-now',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const { integradorId, yearMonth, dryRun, force } = req.body ?? {}
    const r = await invoiceGenerator.triggerNow({
      integradorId: integradorId ?? null,
      yearMonth,
      dryRun:       !!dryRun,
      force:        !!force,
    })
    logger.info({ actorUserId: req.jwtPayload?.sub, ...r }, 'admin_invoice_run_now')
    res.json(r)
  }),
)

// ── POST /admin/billing/notifications/run-now ───────────────────────────────

adminBillingActionsRouter.post('/notifications/run-now',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const r = await tickBillingNotifications()
    logger.info({ actorUserId: req.jwtPayload?.sub, ...r }, 'admin_billing_notif_run_now')
    res.json(r)
  }),
)

// ── GET /admin/billing/audit-log ─────────────────────────────────────────────

adminBillingActionsRouter.get('/audit-log',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 200)
    const rows = await prisma.asaasConfigAudit.findMany({
      orderBy: { createdAt: 'desc' },
      take:    limit,
    })

    // Enriquecer com email do user (se ainda existir)
    const userIds = [...new Set(rows.map(r => r.actorUserId).filter(Boolean))] as string[]
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, name: true },
        })
      : []
    const userById = new Map(users.map(u => [u.id, u]))

    res.json(rows.map(r => ({
      id:         r.id,
      action:     r.action,
      actorEmail: r.actorUserId ? (userById.get(r.actorUserId)?.email ?? null) : null,
      actorName:  r.actorUserId ? (userById.get(r.actorUserId)?.name ?? null)  : null,
      metadata:   r.metadata,
      createdAt:  r.createdAt,
    })))
  }),
)
