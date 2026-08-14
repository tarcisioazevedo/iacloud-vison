/**
 * notify-prefs.ts — Preferências de notificação do usuário logado.
 *
 *   GET    /notify/prefs                     — minhas preferências (cria default se n/a)
 *   PUT    /notify/prefs                     — atualiza minhas preferências
 *   POST   /notify/test                      — dispara TEST em canal escolhido
 *   GET    /notify/log                       — histórico do que enviei (logged-in user)
 *   POST   /notify/admin/run-detection       — força rodada do cron (SUPER_ADMIN)
 */
import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { requireAuth, requireRole } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { prisma } from '../lib/prisma'
import { ValidationError } from '../lib/errors'
import { logger } from '../lib/logger'
import { notify, type NotifyChannel } from '../services/notify.service'
import { runNotifyDetection } from '../services/notify-detection.service'
import { publicRoute } from '../middleware/require-capability'

export const notifyPrefsRouter = Router()
notifyPrefsRouter.use(requireAuth)

function ownerFilter(payload: { sub: string; role: string }) {
  if (payload.role === 'SUPER_ADMIN') return { superAdminId: payload.sub }
  return { userId: payload.sub }
}

// GET /notify/prefs
notifyPrefsRouter.get('/prefs',
  publicRoute(),
  asyncHandler(async (req: Request, res: Response) => {
  const owner = ownerFilter(req.jwtPayload!)
  let prefs = await prisma.notificationPreference.findUnique({ where: owner as any })
  if (!prefs) prefs = await prisma.notificationPreference.create({ data: owner as any })
  res.json(prefs)
}))

// PUT /notify/prefs
const PrefsSchema = z.object({
  pushEnabled:     z.boolean().optional(),
  emailEnabled:    z.boolean().optional(),
  whatsappEnabled: z.boolean().optional(),
  whatsappPhone:   z.string().min(8).max(20).nullable().optional(),
  quietHoursStart: z.number().int().min(0).max(23).optional(),
  quietHoursEnd:   z.number().int().min(0).max(23).optional(),
  eventChannels:   z.record(z.array(z.enum(['push','email','whatsapp','sse']))).optional(),
  dailyDigest:     z.boolean().optional(),
})

notifyPrefsRouter.put('/prefs',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const parse = PrefsSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError('Payload inválido: ' + JSON.stringify(parse.error.flatten()))
  const owner = ownerFilter(req.jwtPayload!)
  // Garante que existe primeiro (upsert via where unique seria mais limpo, mas
  // o owner é union, então update direto).
  let prefs = await prisma.notificationPreference.findUnique({ where: owner as any })
  if (!prefs) prefs = await prisma.notificationPreference.create({ data: owner as any })
  const updated = await prisma.notificationPreference.update({
    where: { id: prefs.id },
    data: parse.data as any,
  })
  res.json(updated)
}))

// POST /notify/test
const TestSchema = z.object({
  channels: z.array(z.enum(['push','email','whatsapp','sse'])).min(1),
})
notifyPrefsRouter.post('/test',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const parse = TestSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError('Informe ao menos 1 canal')
  const owner = ownerFilter(req.jwtPayload!)
  const result = await notify({
    event: 'TEST',
    recipients: [owner],
    channels: parse.data.channels as NotifyChannel[],
    payload: {
      title: '✅ Notificação de teste',
      body: `Esta é uma notificação de teste enviada em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`,
      url: '/admin/comercial',
    },
  })
  logger.info({ owner, channels: parse.data.channels, result }, 'notify_test_dispatched')
  res.json(result)
}))

// GET /notify/log
notifyPrefsRouter.get('/log',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const owner = ownerFilter(req.jwtPayload!)
  const filter: any = owner.userId
    ? { recipientUserId: owner.userId }
    : { recipientSuperAdminId: owner.superAdminId }
  const limit = Math.min(parseInt(String(req.query.limit ?? '100'), 10) || 100, 500)
  const items = await prisma.notificationDeliveryLog.findMany({
    where: filter,
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  res.json({ items, total: items.length })
}))

// POST /notify/admin/run-detection — força rodada (debug/QA)
notifyPrefsRouter.post('/admin/run-detection',
  publicRoute(),
  requireRole('SUPER_ADMIN', 'ADMIN_GLOBAL'), asyncHandler(async (_req, res) => {
  const result = await runNotifyDetection()
  res.json({ ok: true, result })
}))
