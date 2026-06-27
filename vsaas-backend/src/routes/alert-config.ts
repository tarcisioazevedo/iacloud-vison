/**
 * alert-config.ts — Configuração global de alertas + histórico de entregas.
 *
 *   GET  /alert-config              → configuração do tenant atual
 *   PUT  /alert-config              → atualiza configuração
 *   GET  /alert-deliveries          → histórico de envios (paginado + filtros)
 *   POST /alert-deliveries/:id/retry → reenvio de alerta FAILED
 */

import { Router } from 'express'
import { z }      from 'zod'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { requireAuth }  from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { ValidationError, ForbiddenError, NotFoundError } from '../lib/errors'
import { sendMail, loadTemplate, renderTemplate } from '../lib/smtp'
import { auditUpdate } from '../lib/audit-helpers'
import { requires, publicRoute } from '../middleware/require-capability'
import { CAPABILITIES } from '../lib/capabilities'
import { maskEmail } from '../lib/pii-mask'

export const alertConfigRouter    = Router()
export const alertDeliveriesRouter = Router()

alertConfigRouter.use(requireAuth)
alertDeliveriesRouter.use(requireAuth)

// ── Schema ────────────────────────────────────────────────────────────────────

const ConfigSchema = z.object({
  cooldownCameraDown:  z.number().int().min(0).max(86400).optional(),
  cooldownTrigger:     z.number().int().min(0).max(86400).optional(),
  cooldownCameraUp:    z.number().int().min(0).max(86400).optional(),
  offlineGraceSec:     z.number().int().min(0).max(3600).optional(),
  maxEmailsPerHour:    z.number().int().min(1).max(500).optional(),
  maxEmailsPerDay:     z.number().int().min(1).max(5000).optional(),
  digestEnabled:       z.boolean().optional(),
  digestTime:          z.string().regex(/^\d{2}:\d{2}$/).optional(),
  digestTimezone:      z.string().max(60).optional(),
  integradorForceReceiveCritical: z.boolean().optional(),
})

// ── Helper: resolve clienteFinalId a partir do JWT ────────────────────────────

async function resolveCfId(jwt: { sub: string; role: string; integradorId?: string }, query: any): Promise<string> {
  if (jwt.role === 'SUPER_ADMIN') {
    if (!query.clienteFinalId) throw new ValidationError('Informe clienteFinalId')
    return query.clienteFinalId
  }
  if (jwt.role === 'INTEGRADOR_ADMIN') {
    if (query.clienteFinalId) {
      const cf = await prisma.clienteFinal.findFirst({
        where: { id: query.clienteFinalId, integradorId: jwt.integradorId! },
        select: { id: true },
      })
      if (!cf) throw new ForbiddenError('ClienteFinal não pertence ao seu integrador')
      return query.clienteFinalId
    }
    throw new ValidationError('Informe clienteFinalId')
  }
  const user = await prisma.user.findUnique({ where: { id: jwt.sub }, select: { clienteFinalId: true } })
  if (!user?.clienteFinalId) throw new ForbiddenError('Usuário sem cliente final')
  return user.clienteFinalId
}

// ── GET /alert-config ─────────────────────────────────────────────────────────

alertConfigRouter.get('/',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  if (jwt.role === 'CLIENTE_VIEWER') throw new ForbiddenError('Sem permissão')

  const cfId = await resolveCfId(jwt, req.query)

  const config = await prisma.alertConfig.findUnique({ where: { clienteFinalId: cfId } })

  // Retorna defaults se não existe ainda
  res.json(config ?? {
    clienteFinalId:  cfId,
    cooldownCameraDown:  3600,
    cooldownTrigger:     300,
    cooldownCameraUp:    600,
    offlineGraceSec:     120,
    maxEmailsPerHour:    20,
    maxEmailsPerDay:     100,
    digestEnabled:       false,
    digestTime:          '08:00',
    digestTimezone:      'America/Sao_Paulo',
    integradorForceReceiveCritical: false,
  })
}))

// ── PUT /alert-config ─────────────────────────────────────────────────────────

alertConfigRouter.put('/',
  requires(CAPABILITIES.ALERT_CONFIG_MANAGE),
  asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  if (['CLIENTE_VIEWER', 'INTEGRADOR_TECNICO', 'CLIENTE_OPERADOR', 'CLIENTE_SUPERVISOR'].includes(jwt.role)) {
    throw new ForbiddenError('Apenas ADMIN pode alterar configurações de alerta')
  }

  const cfId  = await resolveCfId(jwt, req.query)
  const parse = ConfigSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0].message)

  // integradorForceReceiveCritical só pode ser alterado pelo INTEGRADOR_ADMIN ou SUPER_ADMIN
  if (parse.data.integradorForceReceiveCritical !== undefined &&
      !['SUPER_ADMIN', 'INTEGRADOR_ADMIN'].includes(jwt.role)) {
    throw new ForbiddenError('Apenas o Integrador pode alterar essa configuração')
  }

  // Onda 12.4 — captura ANTES para diff
  const before = await prisma.alertConfig.findUnique({ where: { clienteFinalId: cfId } })

  const config = await prisma.alertConfig.upsert({
    where:  { clienteFinalId: cfId },
    update: parse.data,
    create: { clienteFinalId: cfId, ...parse.data },
  })

  // Onda 12.4 — ALERT_CONFIG_CHANGED com diff (mudança de destinatário é
  // crítica: atacante pode redirecionar alertas para conta dele).
  await auditUpdate(prisma, {
    action:     'ALERT_CONFIG_CHANGED',
    resource:   'AlertConfig',
    resourceId: config.id,
    before:     before ?? {},
    after:      config,
    metadata:   { clienteFinalId: cfId },
    req,
  })

  logger.info({ clienteFinalId: cfId, actorId: jwt.sub }, 'alert_config_updated')
  res.json(config)
}))

// ── GET /alert-deliveries ─────────────────────────────────────────────────────

const DeliveryQuerySchema = z.object({
  clienteFinalId: z.string().uuid().optional(),
  cameraId:       z.string().uuid().optional(),
  eventType:      z.string().optional(),
  status:         z.string().optional(),
  limit:          z.coerce.number().int().min(1).max(200).optional(),
  offset:         z.coerce.number().int().min(0).optional(),
})

alertDeliveriesRouter.get('/',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const jwt   = req.jwtPayload!
  if (jwt.role === 'CLIENTE_VIEWER') throw new ForbiddenError('Sem permissão')

  const parse = DeliveryQuerySchema.safeParse(req.query)
  if (!parse.success) throw new ValidationError('Filtros inválidos')
  const { cameraId, eventType, status, limit = 50, offset = 0 } = parse.data

  let cfId: string | undefined
  if (jwt.role !== 'SUPER_ADMIN') {
    cfId = await resolveCfId(jwt, req.query)
  } else {
    cfId = parse.data.clienteFinalId
  }

  const where: any = {
    ...(cfId ? { clienteFinalId: cfId } : {}),
    ...(cameraId  ? { cameraId  } : {}),
    ...(eventType ? { eventType } : {}),
    ...(status    ? { status    } : {}),
    // Não mostra RATE_LIMITED rows (ruído)
    recipientEmail: { not: 'RATE_LIMITED' },
  }

  const [items, total] = await Promise.all([
    prisma.alertDelivery.findMany({
      where,
      orderBy: { sentAt: 'desc' },
      take:    limit,
      skip:    offset,
    }),
    prisma.alertDelivery.count({ where }),
  ])

  // Contagens por status para o dashboard
  const byStatus = await prisma.alertDelivery.groupBy({
    by: ['status'],
    where: cfId ? { clienteFinalId: cfId } : {},
    _count: { _all: true },
  })

  res.json({
    items, total, limit, offset,
    byStatus: Object.fromEntries(byStatus.map(r => [r.status, r._count._all])),
  })
}))

// ── POST /alert-deliveries/:id/retry ─────────────────────────────────────────

alertDeliveriesRouter.post('/:id/retry',
  requires(CAPABILITIES.ALERT_CONFIG_MANAGE),
  asyncHandler(async (req, res) => {
  const jwt = req.jwtPayload!
  if (['CLIENTE_VIEWER', 'INTEGRADOR_TECNICO'].includes(jwt.role)) {
    throw new ForbiddenError('Sem permissão')
  }

  // Anti-enumeração: filtro de tenant aplicado na própria query. Recurso
  // fora do escopo do ator vira 404, idêntico a "não existe" (não 403).
  const where: any = { id: req.params.id }
  if (jwt.role === 'INTEGRADOR_ADMIN') {
    where.integradorId = jwt.integradorId
  } else if (jwt.role !== 'SUPER_ADMIN') {
    const cfId = await resolveCfId(jwt, req.query)
    where.clienteFinalId = cfId
  }

  const delivery = await prisma.alertDelivery.findFirst({ where })
  if (!delivery) throw new NotFoundError('AlertDelivery')
  if (delivery.status !== 'FAILED') {
    return res.json({ ok: false, error: 'Apenas entregas FAILED podem ser reenviadas' })
  }

  // Recarrega template e reenvia
  const tpl = await loadTemplate(
    delivery.eventType === 'CAMERA_DOWN' ? 'camera_down' :
    delivery.eventType === 'CAMERA_UP'  ? 'camera_up'   :
    delivery.eventType === 'DIGEST'     ? 'alert_digest' : 'alert'
  )

  if (!tpl) return res.json({ ok: false, error: 'Template não encontrado' })

  const payload = (delivery.metadataJson as Record<string, string>) ?? {}
  const subject = renderTemplate(tpl.subject, payload)
  const text    = renderTemplate(tpl.body,    payload)

  const result = await sendMail({ to: delivery.recipientEmail, subject, text })

  await prisma.alertDelivery.update({
    where: { id: delivery.id },
    data:  { status: result.sent ? 'SENT' : 'FAILED', errorMsg: result.reason ?? null },
  })

  logger.info({ deliveryId: delivery.id, toMasked: maskEmail(delivery.recipientEmail), ok: result.sent }, 'alert_delivery_retried')
  res.json(result.sent ? { ok: true } : { ok: false, error: result.reason })
}))
