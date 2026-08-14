/**
 * Sprint Q.1 — WebPush VAPID routes.
 *
 *   GET    /push/vapid-public-key            → chave pública para o navegador
 *   POST   /push/subscribe                   → registra PushSubscription
 *   DELETE /push/subscribe/:p256dh           → unsubscribe
 *   GET    /push/subscriptions               → lista do actor logado
 *   POST   /push/test                        → dispara um push de teste
 */
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { asyncHandler } from '../middleware/async-handler'
import { ValidationError } from '../lib/errors'
import { getVapidPublicKey, isSimulated, broadcast } from '../lib/webpush'
import { publicRoute } from '../middleware/require-capability'

export const pushRouter = Router()

// Public — frontend precisa antes de tentar subscribe
pushRouter.get('/vapid-public-key',
  publicRoute(),
  asyncHandler(async (_req, res) => {
  const key = await getVapidPublicKey()
  res.json({ publicKey: key, simulated: isSimulated() })
}))

pushRouter.use(requireAuth)

const SubscribeSchema = z.object({
  endpoint:  z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(40).max(200),
    auth:   z.string().min(10).max(200),
  }),
  userAgent: z.string().max(500).optional(),
})

function actorFilter(payload: { sub: string; role: string }): { superAdminId?: string; integradorId?: string; userId?: string } {
  if (payload.role === 'SUPER_ADMIN') return { superAdminId: payload.sub }
  if (payload.role === 'INTEGRADOR_ADMIN') return { integradorId: payload.sub }
  return { userId: payload.sub }
}

pushRouter.post('/subscribe',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const parse = SubscribeSchema.safeParse(req.body)
  if (!parse.success) throw new ValidationError(parse.error.errors[0]?.message ?? 'subscription inválida')
  const { endpoint, keys, userAgent } = parse.data
  const actor = actorFilter(req.jwtPayload!)

  // Idempotência: se a mesma p256dh já existe, faz upsert reativando.
  const sub = await prisma.pushSubscription.upsert({
    where: { p256dh: keys.p256dh },
    create: {
      endpoint,
      p256dh:   keys.p256dh,
      authKey:  keys.auth,
      userAgent,
      active:   true,
      ...actor,
    },
    update: {
      endpoint,
      authKey: keys.auth,
      userAgent,
      active:  true,
      failureCount: 0,
      lastErrorMsg: null,
      ...actor,
    },
  })

  res.status(201).json({ id: sub.id, active: sub.active })
}))

pushRouter.delete('/subscribe/:p256dh',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const p256dh = String(req.params.p256dh)
  const actor = actorFilter(req.jwtPayload!)
  const result = await prisma.pushSubscription.updateMany({
    where: { p256dh, ...actor },
    data:  { active: false },
  })
  res.json({ unsubscribed: result.count })
}))

pushRouter.get('/subscriptions',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const actor = actorFilter(req.jwtPayload!)
  const subs = await prisma.pushSubscription.findMany({
    where: { ...actor, active: true },
    select: {
      id: true, endpoint: true, userAgent: true, lastUsedAt: true,
      failureCount: true, createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })
  res.json({ items: subs })
}))

const TestSchema = z.object({
  title: z.string().max(120).optional(),
  body:  z.string().max(500).optional(),
})

pushRouter.post('/test',
  publicRoute(),
  asyncHandler(async (req, res) => {
  const parse = TestSchema.safeParse(req.body ?? {})
  if (!parse.success) throw new ValidationError('payload inválido')
  const actor = actorFilter(req.jwtPayload!)
  const summary = await broadcast(actor, {
    title: parse.data.title ?? '🚨 VSaaS',
    body:  parse.data.body ?? 'Notificação de teste recebida com sucesso.',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag: 'icv-test',
    url: '/',
    data: { test: true, ts: Date.now() },
  })
  res.json(summary)
}))
