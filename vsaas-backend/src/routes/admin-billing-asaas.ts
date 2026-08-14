/**
 * admin-billing-asaas.ts — painel SUPER_ADMIN pra gerenciar integração Asaas.
 *
 *   GET    /admin/billing/asaas/status              → estado + última validação
 *   POST   /admin/billing/asaas/test-connection     → revalida agora
 *   POST   /admin/billing/asaas/rotate-api-key      → troca a chave (valida + persiste)
 *   POST   /admin/billing/asaas/rotate-webhook-secret → gera novo secret (cliente copia pro painel Asaas)
 *
 * Gating: requireRole SUPER_ADMIN | ADMIN_GLOBAL apenas.
 * Auditoria: cada rotação grava `updatedById` no model AsaasGlobalConfig + AuditLog.
 */
import { Router } from 'express'
import { publicRoute } from '../middleware/require-capability'
import { z } from 'zod'
import { requireAuth, requireRole } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { ValidationError } from '../lib/errors'
import { logger } from '../lib/logger'
import {
  getAsaasConfig,
  rotateApiKey,
  rotateWebhookSecret,
  testAsaasConnection,
} from '../services/asaas-config.service'
import { invalidateAsaasClient } from '../services/asaas.service'

export const adminBillingAsaasRouter = Router()
adminBillingAsaasRouter.use(requireAuth)
adminBillingAsaasRouter.use(requireRole('SUPER_ADMIN', 'ADMIN_GLOBAL'))

// ── GET /admin/billing/asaas/status ──────────────────────────────────────────

adminBillingAsaasRouter.get('/status',
  publicRoute(),
  asyncHandler(async (_req, res) => {
    const cfg = await getAsaasConfig({ forceReload: true })
    res.json({
      configured:        !!cfg.apiKey,
      source:            cfg.source,
      environment:       cfg.environment,
      lastValidatedAt:   cfg.lastValidatedAt,
      lastValidatedOk:   cfg.lastValidatedOk,
      lastError:         cfg.lastError,
      accountName:       cfg.accountName,
      accountEmail:      cfg.accountEmail,
      // Não expõe a key. Mostra apenas prefixo (8 chars) pra UI confirmar.
      apiKeyPreview:     cfg.apiKey ? cfg.apiKey.slice(0, 12) + '…' : null,
      webhookSecretSet:  !!cfg.webhookSecret,
    })
  }),
)

// ── POST /admin/billing/asaas/test-connection ────────────────────────────────

adminBillingAsaasRouter.post('/test-connection',
  publicRoute(),
  asyncHandler(async (_req, res) => {
    const r = await testAsaasConnection()
    res.json(r)
  }),
)

// ── POST /admin/billing/asaas/rotate-api-key ─────────────────────────────────

const RotateKeySchema = z.object({
  apiKey:      z.string().min(16, 'API key inválida (mínimo 16 chars)'),
  environment: z.enum(['PROD', 'SANDBOX']),
})

adminBillingAsaasRouter.post('/rotate-api-key',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const parsed = RotateKeySchema.safeParse(req.body)
    if (!parsed.success) {
      throw new ValidationError('Payload inválido', { details: parsed.error.flatten() })
    }
    const actorUserId = req.jwtPayload?.sub

    const r = await rotateApiKey(parsed.data.apiKey, parsed.data.environment, actorUserId)
    if (!r.ok) {
      logger.warn({ actorUserId, errors: r.errors }, 'admin_asaas_rotate_key_rejected')
      return res.status(400).json({ ok: false, errors: r.errors })
    }

    // Force-refresh do cliente axios (próxima chamada já usa nova key)
    invalidateAsaasClient()

    logger.info({
      actorUserId,
      environment:  parsed.data.environment,
      accountName:  r.accountName,
    }, 'admin_asaas_api_key_rotated')

    res.json({
      ok:           true,
      validatedAt:  r.validatedAt,
      accountName:  r.accountName,
      accountEmail: r.accountEmail,
    })
  }),
)

// ── POST /admin/billing/asaas/rotate-webhook-secret ──────────────────────────

adminBillingAsaasRouter.post('/rotate-webhook-secret',
  publicRoute(),
  asyncHandler(async (req, res) => {
    const actorUserId = req.jwtPayload?.sub
    const r = await rotateWebhookSecret(actorUserId)

    logger.info({ actorUserId }, 'admin_asaas_webhook_secret_rotated')

    res.json({
      ok:        true,
      newSecret: r.newSecret,
      message:   'Copie este secret pro painel Asaas em Integrações → Webhooks → Editar → Token de autenticação. Sem isso, webhooks novos vão receber 401.',
    })
  }),
)
