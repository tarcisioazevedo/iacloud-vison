/**
 * Webhook Asaas — POST /webhooks/asaas (público, validado por HMAC).
 * Idempotência por eventId UNIQUE. Worker de processamento: Fase 2.
 */
import { Router } from 'express'
import { prisma } from '../lib/prisma'
import { isBillingEnabled, verifyWebhookSignature } from '../services/asaas.service'
import { logger } from '../lib/logger'

const router = Router()

router.post('/asaas', async (req, res) => {
  if (!isBillingEnabled()) {
    return res.status(503).json({
      error: 'billing_disabled',
      message: 'BILLING_ENABLED=false — webhooks Asaas não processados.',
    })
  }
  if (!process.env.ASAAS_WEBHOOK_SECRET) {
    logger.error('asaas_webhook_no_secret')
    return res.status(503).json({ error: 'webhook_secret_missing' })
  }
  if (!verifyWebhookSignature(req as any)) {
    logger.warn({ ip: req.ip }, 'asaas_webhook_invalid_signature')
    return res.status(401).json({ error: 'invalid_signature' })
  }

  const body = req.body
  const eventId: string | undefined = body?.id ?? body?.event?.id
  const eventName: string | undefined = body?.event ?? body?.event?.name
  if (!eventId || !eventName) {
    return res.status(400).json({ error: 'malformed_event' })
  }

  try {
    const existing = await prisma.asaasWebhookEvent.findUnique({ where: { eventId } })
    if (existing) {
      return res.json({ ok: true, status: existing.status, idempotent: true })
    }
    await prisma.asaasWebhookEvent.create({
      data: { eventId, eventName, payloadJson: body, status: 'PENDING' },
    })
    res.json({ ok: true, status: 'PENDING' })
  } catch (err) {
    logger.error({ err, eventId, eventName }, 'asaas_webhook_persist_failed')
    res.status(500).json({ error: 'persist_failed' })
  }
})

export default router
