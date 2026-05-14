/**
 * Admin Notifications — instância WhatsApp do FABRICANTE (super-admin).
 *
 * Singleton (id="system" no DB). Recebe alertas comerciais (leads/demos/
 * aprovações) e do sistema (P0/P1) destinados ao SUPER_ADMIN. Não substitui
 * as instâncias por ClienteFinal — coexiste com elas.
 *
 * Mapping de endpoints (paralelo ao /notifications/whatsapp/*):
 *   GET    /admin/notifications/whatsapp                 → estado atual + sync
 *   POST   /admin/notifications/whatsapp/instance        → cria/reconecta
 *   POST   /admin/notifications/whatsapp/refresh         → renova QR
 *   POST   /admin/notifications/whatsapp/test            → envia teste
 *   POST   /admin/notifications/whatsapp/logout          → desconecta
 *   POST   /admin/notifications/whatsapp/delete          → remove instância
 *   POST   /admin/notifications/whatsapp/recipients      → adiciona telefone
 *   DELETE /admin/notifications/whatsapp/recipients      → remove telefone
 *
 * RBAC: requireRole('SUPER_ADMIN', 'ADMIN_GLOBAL'). Os endpoints aqui não
 * usam clienteFinalId em momento algum — operam sobre o singleton.
 */
import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requireRole } from '../middleware/auth'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { ValidationError, NotFoundError } from '../lib/errors'
import {
  createInstance,
  connectInstance,
  syncInstance,
  logoutInstance,
  deleteInstance,
  restartInstance,
  sendText,
  normalizePhone,
  type EvolutionInstanceSnapshot,
  type EvolutionConnectPayload,
} from '../services/evolution.service'

export const adminNotificationsRouter = Router()
adminNotificationsRouter.use(requireAuth)
adminNotificationsRouter.use(requireRole('SUPER_ADMIN', 'ADMIN_GLOBAL'))

const SYSTEM_ID = 'system'
// Reaproveita a instância `iacloud_internal` (já autenticada no número 557131900545
// pela Evolution na VPS 168.119.153.216). Antes apontava pra
// `icv-iacloud-system-fabrican`, que ficava perpetuamente desconectada porque o
// WhatsApp bloqueia o noise handshake dos IPs do datacenter principal.
// Histórico: 2026-05-14.
const DEFAULT_SYSTEM_INSTANCE_NAME = 'iacloud_internal'

// ── Helpers ───────────────────────────────────────────────────────────────────

function serializeChannel(ch: {
  id:               string
  instanceName:     string
  instanceId:       string | null
  connectionState:  string
  phoneNumber:      string | null
  profileName:      string | null
  pairingCode:      string | null
  qrCodePayload:    string | null
  lastQrAt:         Date | null
  lastConnectedAt:  Date | null
  lastSyncAt:       Date | null
  lastError:        string | null
  isActive:         boolean
  recipients:       string[]
  createdAt:        Date
  updatedAt:        Date
}) {
  return {
    id:              ch.id,
    scope:           'system' as const,
    instanceName:    ch.instanceName,
    instanceId:      ch.instanceId,
    connectionState: ch.connectionState,
    phoneNumber:     ch.phoneNumber,
    profileName:     ch.profileName,
    pairingCode:     ch.pairingCode,
    qrCodePayload:   ch.qrCodePayload,
    lastQrAt:        ch.lastQrAt,
    lastConnectedAt: ch.lastConnectedAt,
    lastSyncAt:      ch.lastSyncAt,
    lastError:       ch.lastError,
    isActive:        ch.isActive,
    recipients:      ch.recipients,
    createdAt:       ch.createdAt,
    updatedAt:       ch.updatedAt,
  }
}

async function applySnapshot(
  instanceName: string,
  snapshot: EvolutionInstanceSnapshot | null,
  connect: EvolutionConnectPayload | null,
) {
  const now = new Date()
  const data: Record<string, unknown> = {
    instanceName,
    lastSyncAt: now,
    updatedAt:  now,
  }

  if (snapshot) {
    data['instanceId']      = snapshot.instanceId
    data['connectionState'] = snapshot.connectionState
    if (snapshot.phoneNumber) data['phoneNumber'] = snapshot.phoneNumber
    if (snapshot.profileName) data['profileName'] = snapshot.profileName
    if (snapshot.connectionState === 'open') data['lastConnectedAt'] = now
  }

  if (connect?.qrCodePayload) {
    data['qrCodePayload'] = connect.qrCodePayload
    data['lastQrAt']      = now
  }
  if (connect?.pairingCode) data['pairingCode'] = connect.pairingCode

  return prisma.systemNotificationChannel.upsert({
    where:  { id: SYSTEM_ID },
    create: { id: SYSTEM_ID, provider: 'evolution', instanceName, ...data },
    update: data,
  })
}

// ── GET /admin/notifications/whatsapp ─────────────────────────────────────────

adminNotificationsRouter.get('/whatsapp', async (_req, res) => {
  const channel = await prisma.systemNotificationChannel.findUnique({ where: { id: SYSTEM_ID } })
  if (!channel) { res.json({ channel: null }); return }

  try {
    const snapshot = await syncInstance(channel.instanceName)
    if (snapshot) {
      const updated = await applySnapshot(channel.instanceName, snapshot, null)
      res.json({ channel: serializeChannel(updated) })
      return
    }
  } catch (err) {
    logger.warn({ err }, 'admin-notifications.whatsapp.sync_error')
  }

  res.json({ channel: serializeChannel(channel) })
})

// ── POST /admin/notifications/whatsapp/instance ───────────────────────────────

adminNotificationsRouter.post('/whatsapp/instance', async (_req, res) => {
  const existing = await prisma.systemNotificationChannel.findUnique({ where: { id: SYSTEM_ID } })
  const instanceName = existing?.instanceName ?? DEFAULT_SYSTEM_INSTANCE_NAME

  let snapshot = await syncInstance(instanceName)
  let connect: EvolutionConnectPayload = { pairingCode: null, qrCodePayload: null, count: 0, raw: null }

  if (!snapshot) {
    snapshot = await createInstance(instanceName)
    logger.info({ instanceName }, 'admin-notifications.whatsapp.instance_created')
  }

  connect = await connectInstance(instanceName)

  const hasQr = !!(connect.qrCodePayload || connect.pairingCode)
  if (!hasQr && snapshot?.connectionState !== 'open') {
    logger.warn({ instanceName }, 'admin-notifications.whatsapp.stuck_restart')
    const restarted = await restartInstance(instanceName)
    snapshot = restarted.snapshot
    connect  = restarted.connect
  }

  const channel = await applySnapshot(instanceName, snapshot, connect)
  logger.info({ instanceName, state: channel.connectionState }, 'admin-notifications.whatsapp.provisioned')

  res.json({ channel: serializeChannel(channel) })
})

// ── POST /admin/notifications/whatsapp/refresh ────────────────────────────────

adminNotificationsRouter.post('/whatsapp/refresh', async (_req, res) => {
  const channel = await prisma.systemNotificationChannel.findUnique({ where: { id: SYSTEM_ID } })
  if (!channel) throw new NotFoundError('Canal WhatsApp do sistema não configurado. Use POST /instance primeiro.')

  let connect = await connectInstance(channel.instanceName)
  if (!connect.qrCodePayload && !connect.pairingCode && channel.connectionState !== 'open') {
    const restarted = await restartInstance(channel.instanceName)
    connect = restarted.connect
  }

  const updated = await applySnapshot(channel.instanceName, null, connect)
  res.json({ channel: serializeChannel(updated) })
})

// ── POST /admin/notifications/whatsapp/broadcast ──────────────────────────────
// Envia uma mensagem para TODOS os destinatários cadastrados na instância
// singleton. Usado pelo botão "Enviar para todos" na aba Destinatários.

const BroadcastSchema = z.object({
  message: z.string().min(1).max(2000),
})

adminNotificationsRouter.post('/whatsapp/broadcast', async (req, res) => {
  const body = BroadcastSchema.safeParse(req.body)
  if (!body.success) throw new ValidationError(body.error.errors[0]?.message ?? 'Dados inválidos')

  const channel = await prisma.systemNotificationChannel.findUnique({ where: { id: SYSTEM_ID } })
  if (!channel)                           throw new NotFoundError('Canal WhatsApp do sistema não configurado')
  if (channel.connectionState !== 'open') throw new ValidationError('WhatsApp não conectado. Escaneie o QR Code primeiro.')
  if (channel.recipients.length === 0)    throw new ValidationError('Nenhum destinatário cadastrado.')

  const text = body.data.message
  let sent = 0
  let failed = 0

  for (const phone of channel.recipients) {
    try {
      await sendText(channel.instanceName, phone, text)
      sent++
    } catch (err: any) {
      failed++
      logger.warn({ err, phone }, 'admin-notifications.whatsapp.broadcast.recipient_failed')
    }
  }

  logger.info({ sent, failed }, 'admin-notifications.whatsapp.broadcast')
  res.json({ ok: true, sent, failed })
})

// ── POST /admin/notifications/whatsapp/test ───────────────────────────────────

const TestSchema = z.object({
  phoneNumber: z.string().min(10).max(20),
  message:     z.string().max(2000).optional(),
})

adminNotificationsRouter.post('/whatsapp/test', async (req, res) => {
  const body = TestSchema.safeParse(req.body)
  if (!body.success) throw new ValidationError(body.error.errors[0]?.message ?? 'Dados inválidos')

  const channel = await prisma.systemNotificationChannel.findUnique({ where: { id: SYSTEM_ID } })
  if (!channel)                           throw new NotFoundError('Canal WhatsApp do sistema não configurado')
  if (channel.connectionState !== 'open') throw new ValidationError('WhatsApp não conectado. Escaneie o QR Code primeiro.')

  const text = body.data.message ??
    `✅ *VSaaS — Teste de notificação (sistema)*\n\nCanal WhatsApp do fabricante conectado com sucesso!\nInstância: ${channel.instanceName}`

  try {
    await sendText(channel.instanceName, body.data.phoneNumber, text)
    logger.info({ phoneNumber: body.data.phoneNumber }, 'admin-notifications.whatsapp.test_sent')
    res.json({ ok: true })
  } catch (err: any) {
    const errorMsg = err?.message ?? String(err)
    logger.warn({ err }, 'admin-notifications.whatsapp.test_failed')
    res.status(502).json({ ok: false, error: errorMsg })
  }
})

// ── POST /admin/notifications/whatsapp/logout ─────────────────────────────────

adminNotificationsRouter.post('/whatsapp/logout', async (_req, res) => {
  const channel = await prisma.systemNotificationChannel.findUnique({ where: { id: SYSTEM_ID } })
  if (!channel) throw new NotFoundError('Canal WhatsApp do sistema não configurado')

  await logoutInstance(channel.instanceName)

  const updated = await prisma.systemNotificationChannel.update({
    where: { id: SYSTEM_ID },
    data:  {
      connectionState:    'close',
      qrCodePayload:      null,
      pairingCode:        null,
      lastDisconnectedAt: new Date(),
      updatedAt:          new Date(),
    },
  })

  logger.info({ instanceName: channel.instanceName }, 'admin-notifications.whatsapp.logout')
  res.json({ channel: serializeChannel(updated) })
})

// ── POST /admin/notifications/whatsapp/delete ─────────────────────────────────

adminNotificationsRouter.post('/whatsapp/delete', async (_req, res) => {
  const channel = await prisma.systemNotificationChannel.findUnique({ where: { id: SYSTEM_ID } })
  if (!channel) throw new NotFoundError('Canal WhatsApp do sistema não configurado')

  await deleteInstance(channel.instanceName)
  await prisma.systemNotificationChannel.delete({ where: { id: SYSTEM_ID } })

  logger.info({ instanceName: channel.instanceName }, 'admin-notifications.whatsapp.deleted')
  res.json({ ok: true })
})

// ── GET /admin/notifications/whatsapp/logs ────────────────────────────────────
// Histórico de envios da instância singleton do sistema. Filtra NotificationLog
// pelo instanceName atual do canal (não usa clienteFinalId pois o canal admin
// não tem dono — é singleton). Hoje broadcast/test do admin ainda não gravam
// log; quando começarem, este endpoint já estará pronto.

adminNotificationsRouter.get('/whatsapp/logs', async (req, res) => {
  const channel = await prisma.systemNotificationChannel.findUnique({ where: { id: SYSTEM_ID } })
  if (!channel) {
    res.json({ logs: [], pagination: { total: 0, page: 1, limit: 50, pages: 0 } })
    return
  }

  const status = String(req.query.status ?? '')
  const phone  = String(req.query.phone  ?? '').trim()
  const from   = req.query.from ? new Date(String(req.query.from)) : null
  const to     = req.query.to   ? new Date(String(req.query.to))   : null
  const origin = String(req.query.origin ?? '')
  const q      = String(req.query.q      ?? '').trim()
  const page   = Math.max(1, parseInt(String(req.query.page ?? '1'), 10))
  const limit  = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10)))
  const skip   = (page - 1) * limit

  const where: any = { instanceName: channel.instanceName }
  if (status && ['sent', 'failed', 'delivered'].includes(status)) where.status = status
  if (origin && ['manual', 'alert', 'bulk'].includes(origin)) where.origin = origin
  if (phone)  where.toPhone = { contains: normalizePhone(phone) || phone }
  if (q)      where.message = { contains: q, mode: 'insensitive' }
  if (from || to) {
    where.sentAt = {}
    if (from) where.sentAt.gte = from
    if (to)   where.sentAt.lte = to
  }

  const [total, logs] = await Promise.all([
    prisma.notificationLog.count({ where }),
    prisma.notificationLog.findMany({
      where,
      orderBy: { sentAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true, toPhone: true, message: true, status: true, origin: true,
        errorMessage: true, evolutionMsgId: true, sentAt: true, instanceName: true,
      },
    }),
  ])

  res.json({ logs, pagination: { total, page, limit, pages: Math.ceil(total / limit) } })
})

// ── Recipients ────────────────────────────────────────────────────────────────

const RecipientSchema = z.object({
  phone: z.string().min(10).max(20).regex(/^\+?[\d\s\-().]+$/, 'Número inválido'),
})

adminNotificationsRouter.post('/whatsapp/recipients', async (req, res) => {
  const body = RecipientSchema.safeParse(req.body)
  if (!body.success) throw new ValidationError(body.error.errors[0]?.message ?? 'Telefone inválido')

  const channel = await prisma.systemNotificationChannel.findUnique({ where: { id: SYSTEM_ID } })
  if (!channel) throw new NotFoundError('Canal WhatsApp do sistema não configurado')

  const normalized = normalizePhone(body.data.phone)
  if (!normalized) throw new ValidationError('Número de telefone inválido')

  if (channel.recipients.includes(normalized)) {
    res.json({ channel: serializeChannel(channel) }); return
  }

  const updated = await prisma.systemNotificationChannel.update({
    where: { id: SYSTEM_ID },
    data:  { recipients: [...channel.recipients, normalized], updatedAt: new Date() },
  })

  logger.info({ phone: normalized }, 'admin-notifications.whatsapp.recipient_added')
  res.json({ channel: serializeChannel(updated) })
})

adminNotificationsRouter.delete('/whatsapp/recipients', async (req, res) => {
  const body = RecipientSchema.safeParse(req.body)
  if (!body.success) throw new ValidationError(body.error.errors[0]?.message ?? 'Telefone inválido')

  const channel = await prisma.systemNotificationChannel.findUnique({ where: { id: SYSTEM_ID } })
  if (!channel) throw new NotFoundError('Canal WhatsApp do sistema não configurado')

  const normalized = normalizePhone(body.data.phone)
  const updated = await prisma.systemNotificationChannel.update({
    where: { id: SYSTEM_ID },
    data:  {
      recipients: channel.recipients.filter(r => r !== normalized),
      updatedAt:  new Date(),
    },
  })

  logger.info({ phone: normalized }, 'admin-notifications.whatsapp.recipient_removed')
  res.json({ channel: serializeChannel(updated) })
})
