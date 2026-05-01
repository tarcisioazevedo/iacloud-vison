/**
 * Rotas de Notificações WhatsApp — Evolution API por ClienteFinal.
 *
 * Arquitetura: cada ClienteFinal possui 1 instância Evolution isolada.
 * O provisionamento é automático: ao chamar POST /instance, o backend
 * cria a instância na Evolution API e salva o estado no banco.
 *
 * Endpoints:
 *   GET  /notifications/whatsapp                  — estado da instância do cliente
 *   POST /notifications/whatsapp/instance         — cria / reconecta instância
 *   POST /notifications/whatsapp/refresh          — renova QR Code
 *   POST /notifications/whatsapp/test             — envia mensagem de teste
 *   POST /notifications/whatsapp/logout           — desconecta (mantém instância)
 *   POST /notifications/whatsapp/delete           — remove instância completamente
 *
 *   Destinatários:
 *   POST   /notifications/whatsapp/recipients     — adiciona telefone à lista
 *   DELETE /notifications/whatsapp/recipients     — remove telefone da lista
 *
 *   Log de mensagens:
 *   GET  /notifications/whatsapp/logs             — histórico com filtros
 *
 *   Admin routes (INTEGRADOR_ADMIN + SUPER_ADMIN):
 *   GET  /notifications/whatsapp/admin/all        — lista canais de todos os clientes
 *   POST /notifications/whatsapp/admin/provision/:clienteFinalId — provisiona para cliente
 */

import { Router } from 'express'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { requireAuth } from '../middleware/auth'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { ValidationError, NotFoundError, AuthError } from '../lib/errors'
import {
  buildInstanceName,
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

import { registerClient, unregisterClient, getClientsCount } from '../lib/sse-bus'
import { randomUUID as randomUUID2 } from 'crypto'

export const notificationsRouter = Router()

// ═════════════════════════════════════════════════════════════════════════════
// GET /notifications/stream — Server-Sent Events para popup em tempo real
//
// O painel mantém uma EventSource pendurada aqui. Quando dispatchAlert()
// dispara, broadcastSse() faz res.write nos clientes correspondentes ao tenant.
// ═════════════════════════════════════════════════════════════════════════════
notificationsRouter.get('/stream', requireAuth, (req, res) => {
  const jwt = req.jwtPayload!

  // Headers SSE
  res.setHeader('Content-Type',  'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection',    'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')  // desabilita buffering em proxies (nginx)
  res.flushHeaders?.()

  const id = randomUUID2()
  registerClient({
    id,
    res,
    userId:         jwt.sub,
    integradorId:   jwt.integradorId   ?? null,
    clienteFinalId: jwt.clienteFinalId ?? null,
    role:           jwt.role,
    connectedAt:    Date.now(),
  })

  // Hello inicial — confirma conexão
  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, ts: Date.now(), connected: getClientsCount() })}\n\n`)

  req.on('close', () => unregisterClient(id))
  req.on('aborted', () => unregisterClient(id))
})

// ── Resolvers de tenant ───────────────────────────────────────────────────────

function resolveClienteFinalId(req: Express.Request): string {
  const jwt = req.jwtPayload!
  // Roles de cliente final: JWT já carrega clienteFinalId
  if (jwt.clienteFinalId) return jwt.clienteFinalId
  // Roles de integrador/admin: recebem via query param
  if (['INTEGRADOR_ADMIN', 'INTEGRADOR_TECNICO', 'ADMIN_GLOBAL', 'SUPER_ADMIN'].includes(jwt.role)) {
    const id = (req.query as Record<string, string>)['clienteFinalId']
    if (!id) throw new ValidationError('Informe ?clienteFinalId= na query')
    return id
  }
  throw new AuthError('Acesso restrito a usuários de ClienteFinal ou Integrador')
}

async function assertIntegradorOwnsCliente(jwtPayload: Express.Request['jwtPayload'], clienteFinalId: string) {
  if (!jwtPayload) throw new AuthError('Não autenticado')
  const { role, integradorId } = jwtPayload
  if (role === 'SUPER_ADMIN' || role === 'ADMIN_GLOBAL') return
  // INTEGRADOR_ADMIN e INTEGRADOR_TECNICO só acessam clientes do próprio integrador
  if ((role === 'INTEGRADOR_ADMIN' || role === 'INTEGRADOR_TECNICO') && integradorId) {
    const cf = await prisma.clienteFinal.findFirst({
      where: { id: clienteFinalId, integradorId },
      select: { id: true },
    })
    if (!cf) throw new AuthError('ClienteFinal não pertence ao seu Integrador')
    return
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function serializeChannel(ch: {
  id: string
  clienteFinalId?: string
  instanceName: string
  instanceId: string | null
  connectionState: string
  phoneNumber: string | null
  profileName: string | null
  pairingCode: string | null
  qrCodePayload: string | null
  lastQrAt: Date | null
  lastConnectedAt: Date | null
  lastSyncAt: Date | null
  lastError: string | null
  isActive: boolean
  recipients: string[]
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id:              ch.id,
    clienteFinalId:  ch.clienteFinalId,
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

async function applySnapshotToChannel(
  clienteFinalId: string,
  instanceName: string,
  snapshot: EvolutionInstanceSnapshot | null,
  connect: EvolutionConnectPayload | null,
) {
  const now = new Date()
  const data: Record<string, unknown> = {
    instanceName,
    lastSyncAt: now,
    updatedAt: now,
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

  return prisma.notificationChannel.upsert({
    where:  { clienteFinalId },
    create: { clienteFinalId, provider: 'evolution', ...data },
    update: data,
  })
}

/** Salva entrada no log de mensagens */
async function logMessage(opts: {
  clienteFinalId: string
  instanceName:   string
  toPhone:        string
  message:        string
  status:         'sent' | 'failed'
  evolutionMsgId?: string | null
  errorMessage?:   string | null
  origin?:         string
}) {
  try {
    await prisma.notificationLog.create({
      data: {
        id:             randomUUID(),
        clienteFinalId: opts.clienteFinalId,
        instanceName:   opts.instanceName,
        toPhone:        normalizePhone(opts.toPhone),
        message:        opts.message,
        status:         opts.status,
        evolutionMsgId: opts.evolutionMsgId ?? null,
        errorMessage:   opts.errorMessage ?? null,
        origin:         opts.origin ?? 'manual',
      },
    })
  } catch (err) {
    logger.warn({ err }, 'notifications.log_message_failed')
  }
}

// ── GET /notifications/whatsapp ───────────────────────────────────────────────

notificationsRouter.get('/whatsapp', requireAuth, async (req, res) => {
  const clienteFinalId = resolveClienteFinalId(req)
  await assertIntegradorOwnsCliente(req.jwtPayload, clienteFinalId)

  const channel = await prisma.notificationChannel.findUnique({ where: { clienteFinalId } })
  if (!channel) { res.json({ channel: null }); return }

  try {
    const snapshot = await syncInstance(channel.instanceName)
    if (snapshot) {
      const updated = await applySnapshotToChannel(clienteFinalId, channel.instanceName, snapshot, null)
      res.json({ channel: serializeChannel(updated) })
      return
    }
  } catch (err) {
    logger.warn({ err }, 'notifications.whatsapp.sync_error')
  }

  res.json({ channel: serializeChannel(channel) })
})

// ── POST /notifications/whatsapp/instance ─────────────────────────────────────

notificationsRouter.post('/whatsapp/instance', requireAuth, async (req, res) => {
  const clienteFinalId = resolveClienteFinalId(req)
  await assertIntegradorOwnsCliente(req.jwtPayload, clienteFinalId)

  const clienteFinal = await prisma.clienteFinal.findUnique({
    where: { id: clienteFinalId },
    select: { id: true, name: true, tradeName: true },
  })
  if (!clienteFinal) throw new NotFoundError('ClienteFinal não encontrado')

  const existing = await prisma.notificationChannel.findUnique({ where: { clienteFinalId } })
  const instanceName = existing?.instanceName ?? buildInstanceName({
    name: clienteFinal.tradeName ?? clienteFinal.name,
    id:   clienteFinal.id,
  })

  let snapshot = await syncInstance(instanceName)
  let connect: EvolutionConnectPayload = { pairingCode: null, qrCodePayload: null, count: 0, raw: null }

  if (!snapshot) {
    snapshot = await createInstance(instanceName)
    logger.info({ clienteFinalId, instanceName }, 'notifications.whatsapp.instance_created')
  }

  connect = await connectInstance(instanceName)

  const hasQr = !!(connect.qrCodePayload || connect.pairingCode)
  if (!hasQr && snapshot?.connectionState !== 'open') {
    logger.warn({ instanceName }, 'notifications.whatsapp.stuck_restart')
    const restarted = await restartInstance(instanceName)
    snapshot = restarted.snapshot
    connect  = restarted.connect
  }

  const channel = await applySnapshotToChannel(clienteFinalId, instanceName, snapshot, connect)
  logger.info({ clienteFinalId, instanceName, state: channel.connectionState }, 'notifications.whatsapp.provisioned')

  // Configura webhook para receber atualizações de status/conexão (não bloqueia)
  configureWebhook(instanceName).catch(() => {/* já logado internamente */})

  res.json({ channel: serializeChannel(channel) })
})

// ── POST /notifications/whatsapp/refresh ──────────────────────────────────────

notificationsRouter.post('/whatsapp/refresh', requireAuth, async (req, res) => {
  const clienteFinalId = resolveClienteFinalId(req)
  await assertIntegradorOwnsCliente(req.jwtPayload, clienteFinalId)

  const channel = await prisma.notificationChannel.findUnique({ where: { clienteFinalId } })
  if (!channel) throw new NotFoundError('Canal WhatsApp não configurado. Use POST /instance primeiro.')

  let connect = await connectInstance(channel.instanceName)
  if (!connect.qrCodePayload && !connect.pairingCode && channel.connectionState !== 'open') {
    const restarted = await restartInstance(channel.instanceName)
    connect = restarted.connect
  }

  const updated = await applySnapshotToChannel(clienteFinalId, channel.instanceName, null, connect)
  res.json({ channel: serializeChannel(updated) })
})

// ── POST /notifications/whatsapp/test ─────────────────────────────────────────

const TestSchema = z.object({
  phoneNumber: z.string().min(10).max(20),
  message:     z.string().max(2000).optional(),
})

notificationsRouter.post('/whatsapp/test', requireAuth, async (req, res) => {
  const clienteFinalId = resolveClienteFinalId(req)
  await assertIntegradorOwnsCliente(req.jwtPayload, clienteFinalId)

  const body = TestSchema.safeParse(req.body)
  if (!body.success) throw new ValidationError(body.error.errors[0]?.message ?? 'Dados inválidos')

  const channel = await prisma.notificationChannel.findUnique({ where: { clienteFinalId } })
  if (!channel)                           throw new NotFoundError('Canal WhatsApp não configurado')
  if (channel.connectionState !== 'open') throw new ValidationError('WhatsApp não conectado. Escaneie o QR Code primeiro.')

  const text = body.data.message ??
    `✅ *IA Cloud Vision — Teste de notificação*\n\nCanal WhatsApp conectado com sucesso!\nInstância: ${channel.instanceName}`

  let evolutionMsgId: string | null = null
  let sendStatus: 'sent' | 'failed' = 'sent'
  let errorMsg: string | null = null

  try {
    const result = await sendText(channel.instanceName, body.data.phoneNumber, text) as any
    evolutionMsgId = result?.key?.id ?? result?.id ?? null
    logger.info({ clienteFinalId, phoneNumber: body.data.phoneNumber }, 'notifications.whatsapp.test_sent')
    res.json({ ok: true })
  } catch (err: any) {
    sendStatus  = 'failed'
    errorMsg    = err?.message ?? String(err)
    logger.warn({ clienteFinalId, err }, 'notifications.whatsapp.test_failed')
    res.status(502).json({ ok: false, error: errorMsg })
  } finally {
    await logMessage({
      clienteFinalId,
      instanceName:   channel.instanceName,
      toPhone:        body.data.phoneNumber,
      message:        text,
      status:         sendStatus,
      evolutionMsgId,
      errorMessage:   errorMsg,
      origin:         'manual',
    })
  }
})

// ── POST /notifications/whatsapp/logout ───────────────────────────────────────

notificationsRouter.post('/whatsapp/logout', requireAuth, async (req, res) => {
  const clienteFinalId = resolveClienteFinalId(req)
  await assertIntegradorOwnsCliente(req.jwtPayload, clienteFinalId)

  const channel = await prisma.notificationChannel.findUnique({ where: { clienteFinalId } })
  if (!channel) throw new NotFoundError('Canal WhatsApp não configurado')

  await logoutInstance(channel.instanceName)

  const updated = await prisma.notificationChannel.update({
    where: { clienteFinalId },
    data:  {
      connectionState:    'close',
      qrCodePayload:      null,
      pairingCode:        null,
      lastDisconnectedAt: new Date(),
      updatedAt:          new Date(),
    },
  })

  logger.info({ clienteFinalId }, 'notifications.whatsapp.logout')
  res.json({ channel: serializeChannel(updated) })
})

// ── POST /notifications/whatsapp/delete ───────────────────────────────────────

notificationsRouter.post('/whatsapp/delete', requireAuth, async (req, res) => {
  const clienteFinalId = resolveClienteFinalId(req)
  await assertIntegradorOwnsCliente(req.jwtPayload, clienteFinalId)

  const channel = await prisma.notificationChannel.findUnique({ where: { clienteFinalId } })
  if (!channel) throw new NotFoundError('Canal WhatsApp não configurado')

  await deleteInstance(channel.instanceName)
  await prisma.notificationChannel.delete({ where: { clienteFinalId } })

  logger.info({ clienteFinalId }, 'notifications.whatsapp.deleted')
  res.json({ ok: true })
})

// ── POST /notifications/whatsapp/broadcast — envia para todos os destinatários ─

const BroadcastSchema = z.object({
  message: z.string().min(1).max(2000),
})

notificationsRouter.post('/whatsapp/broadcast', requireAuth, async (req, res) => {
  const clienteFinalId = resolveClienteFinalId(req)
  await assertIntegradorOwnsCliente(req.jwtPayload, clienteFinalId)

  const body = BroadcastSchema.safeParse(req.body)
  if (!body.success) throw new ValidationError(body.error.errors[0]?.message ?? 'Dados inválidos')

  const channel = await prisma.notificationChannel.findUnique({ where: { clienteFinalId } })
  if (!channel)                           throw new NotFoundError('Canal WhatsApp não configurado')
  if (channel.connectionState !== 'open') throw new ValidationError('WhatsApp não conectado. Escaneie o QR Code primeiro.')
  if (channel.recipients.length === 0)    throw new ValidationError('Nenhum destinatário cadastrado.')

  const text = body.data.message
  let sent = 0; let failed = 0

  for (const phone of channel.recipients) {
    let status: 'sent' | 'failed' = 'sent'
    let evolutionMsgId: string | null = null
    let errorMsg: string | null = null

    try {
      const result = await sendText(channel.instanceName, phone, text) as any
      evolutionMsgId = result?.key?.id ?? result?.id ?? null
      sent++
    } catch (err: any) {
      status   = 'failed'
      errorMsg = err?.message ?? String(err)
      failed++
    }

    await logMessage({
      clienteFinalId,
      instanceName:   channel.instanceName,
      toPhone:        phone,
      message:        text,
      status,
      evolutionMsgId,
      errorMessage:   errorMsg,
      origin:         'bulk',
    })
  }

  logger.info({ clienteFinalId, sent, failed }, 'notifications.whatsapp.broadcast')
  res.json({ ok: true, sent, failed })
})

// ── POST /notifications/whatsapp/recipients — adiciona telefone ───────────────

const RecipientSchema = z.object({
  phone: z.string().min(10).max(20).regex(/^\+?[\d\s\-().]+$/, 'Número inválido'),
})

notificationsRouter.post('/whatsapp/recipients', requireAuth, async (req, res) => {
  const clienteFinalId = resolveClienteFinalId(req)
  await assertIntegradorOwnsCliente(req.jwtPayload, clienteFinalId)

  const body = RecipientSchema.safeParse(req.body)
  if (!body.success) throw new ValidationError(body.error.errors[0]?.message ?? 'Telefone inválido')

  const channel = await prisma.notificationChannel.findUnique({ where: { clienteFinalId } })
  if (!channel) throw new NotFoundError('Canal WhatsApp não configurado')

  const normalized = normalizePhone(body.data.phone)
  if (!normalized) throw new ValidationError('Número de telefone inválido')

  if (channel.recipients.includes(normalized)) {
    res.json({ channel: serializeChannel(channel) }); return
  }

  const updated = await prisma.notificationChannel.update({
    where: { clienteFinalId },
    data:  { recipients: [...channel.recipients, normalized], updatedAt: new Date() },
  })

  logger.info({ clienteFinalId, phone: normalized }, 'notifications.whatsapp.recipient_added')
  res.json({ channel: serializeChannel(updated) })
})

// ── DELETE /notifications/whatsapp/recipients — remove telefone ───────────────

notificationsRouter.delete('/whatsapp/recipients', requireAuth, async (req, res) => {
  const clienteFinalId = resolveClienteFinalId(req)
  await assertIntegradorOwnsCliente(req.jwtPayload, clienteFinalId)

  const body = RecipientSchema.safeParse(req.body)
  if (!body.success) throw new ValidationError(body.error.errors[0]?.message ?? 'Telefone inválido')

  const channel = await prisma.notificationChannel.findUnique({ where: { clienteFinalId } })
  if (!channel) throw new NotFoundError('Canal WhatsApp não configurado')

  const normalized = normalizePhone(body.data.phone)
  const updated = await prisma.notificationChannel.update({
    where: { clienteFinalId },
    data:  {
      recipients: channel.recipients.filter(r => r !== normalized),
      updatedAt:  new Date(),
    },
  })

  logger.info({ clienteFinalId, phone: normalized }, 'notifications.whatsapp.recipient_removed')
  res.json({ channel: serializeChannel(updated) })
})

// ── GET /notifications/whatsapp/logs — histórico de envios ───────────────────

notificationsRouter.get('/whatsapp/logs', requireAuth, async (req, res) => {
  const clienteFinalId = resolveClienteFinalId(req)
  await assertIntegradorOwnsCliente(req.jwtPayload, clienteFinalId)

  const q      = String(req.query.q      ?? '').trim()
  const status = String(req.query.status ?? '')
  const phone  = String(req.query.phone  ?? '').trim()
  const from   = req.query.from ? new Date(String(req.query.from)) : null
  const to     = req.query.to   ? new Date(String(req.query.to))   : null
  const origin = String(req.query.origin ?? '')
  const page   = Math.max(1, parseInt(String(req.query.page ?? '1'), 10))
  const limit  = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10)))
  const skip   = (page - 1) * limit

  const where: any = { clienteFinalId }
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
        id: true,
        toPhone: true,
        message: true,
        status: true,
        origin: true,
        errorMessage: true,
        evolutionMsgId: true,
        sentAt: true,
        instanceName: true,
      },
    }),
  ])

  res.json({
    logs,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  })
})

// ── POST /notifications/whatsapp/webhook — recebe eventos da Evolution API ────
//
// A Evolution envia eventos via HTTP POST para esta URL.
// Configuramos na criação/reconexão da instância.
// NÃO requer JWT — usa header "apikey" da Evolution como autenticação.
//
// Eventos tratados:
//   messages.update  → atualiza status para 'delivered' ou 'read'
//   connection.update → atualiza connectionState no banco

notificationsRouter.post('/whatsapp/webhook', async (req, res) => {
  // Valida a apikey da Evolution (evita spam/spoofing)
  const apikey = req.headers['apikey'] as string | undefined
  const expectedKey = process.env.EVOLUTION_API_KEY ?? ''
  if (expectedKey && apikey !== expectedKey) {
    res.status(401).json({ error: 'Unauthorized' }); return
  }

  const event    = req.body?.event    as string | undefined
  const instance = req.body?.instance as string | undefined
  const data     = req.body?.data     as Record<string, unknown> | undefined

  logger.debug({ event, instance }, 'notifications.whatsapp.webhook_received')

  // ── messages.update → marca como delivered ────────────────────────────────
  if (event === 'messages.update' && data) {
    const updates = Array.isArray(data) ? data : [data]
    for (const upd of updates) {
      const msgId  = (upd as any)?.key?.id as string | undefined
      const status = (upd as any)?.update?.status as string | number | undefined
      // Evolution: 3 = delivered, 4 = read
      const isDelivered = status === 3 || status === 'DELIVERY_ACK' || status === 'READ'
      if (msgId && isDelivered) {
        await prisma.notificationLog.updateMany({
          where:  { evolutionMsgId: msgId },
          data:   { status: 'delivered' },
        }).catch(() => {/* silencioso */})
      }
    }
  }

  // ── connection.update → atualiza connectionState ──────────────────────────
  if (event === 'connection.update' && instance && data) {
    const state = (data as any)?.state as string | undefined
    if (state) {
      await prisma.notificationChannel.updateMany({
        where: { instanceName: instance },
        data:  {
          connectionState:    state,
          lastConnectedAt:    state === 'open'  ? new Date() : undefined,
          lastDisconnectedAt: state === 'close' ? new Date() : undefined,
          qrCodePayload:      state === 'open'  ? null : undefined,
          pairingCode:        state === 'open'  ? null : undefined,
          updatedAt:          new Date(),
        },
      }).catch(() => {/* silencioso */})
    }
  }

  res.json({ ok: true })
})

// ── Helpers para configurar webhook na Evolution ──────────────────────────────

async function configureWebhook(instanceName: string): Promise<void> {
  // PUBLIC_BACKEND_URL deve ser alcançável pelo container icv_evolution
  // Ex. dev Docker: http://icv_backend:3000  |  Prod: https://api.dominio.com.br
  const backendUrl = (process.env.PUBLIC_BACKEND_URL ?? 'http://icv_backend:3000').replace(/\/$/, '')
  const webhookUrl = `${backendUrl}/notifications/whatsapp/webhook`
  const evolutionUrl = (process.env.EVOLUTION_API_URL ?? 'http://icv_evolution:8080').replace(/\/$/, '')
  const apiKey = process.env.EVOLUTION_API_KEY ?? ''
  try {
    const axios = (await import('axios')).default
    await axios.post(
      `${evolutionUrl}/webhook/set/${instanceName}`,
      {
        url:               webhookUrl,
        webhook_by_events: false,
        webhook_base64:    false,
        events:            ['MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'SEND_MESSAGE'],
      },
      { headers: { apikey: apiKey }, timeout: 5_000 },
    )
    logger.info({ instanceName, webhookUrl }, 'notifications.whatsapp.webhook_configured')
  } catch (err: any) {
    logger.warn({ err: err?.message, instanceName }, 'notifications.whatsapp.webhook_config_failed')
  }
}

// ── Admin: lista todos os canais do integrador ────────────────────────────────

notificationsRouter.get('/whatsapp/admin/all', requireAuth, async (req, res) => {
  const jwt = req.jwtPayload!
  if (!['INTEGRADOR_ADMIN', 'ADMIN_GLOBAL', 'SUPER_ADMIN'].includes(jwt.role)) {
    throw new AuthError('Acesso restrito a administradores')
  }

  let integradorId: string | undefined
  if (jwt.role === 'INTEGRADOR_ADMIN') {
    integradorId = jwt.integradorId ?? undefined
    if (!integradorId) throw new ValidationError('integradorId ausente no token')
  }

  const clientes = await prisma.clienteFinal.findMany({
    where: integradorId ? { integradorId } : undefined,
    select: { id: true, name: true, tradeName: true, notificationChannel: true },
    orderBy: { name: 'asc' },
  })

  const result = clientes.map(cf => ({
    clienteFinalId:   cf.id,
    clienteFinalName: cf.tradeName ?? cf.name,
    channel: cf.notificationChannel ? serializeChannel(cf.notificationChannel) : null,
  }))

  res.json({ channels: result })
})

// ── Admin: provisiona instância para um clienteFinal específico ──────────────

notificationsRouter.post('/whatsapp/admin/provision/:clienteFinalId', requireAuth, async (req, res) => {
  const jwt = req.jwtPayload!
  if (!['INTEGRADOR_ADMIN', 'ADMIN_GLOBAL', 'SUPER_ADMIN'].includes(jwt.role)) {
    throw new AuthError('Acesso restrito a administradores')
  }

  const clienteFinalId = String(req.params.clienteFinalId)
  await assertIntegradorOwnsCliente(jwt, clienteFinalId)

  const clienteFinal = await prisma.clienteFinal.findUnique({
    where: { id: clienteFinalId },
    select: { id: true, name: true, tradeName: true },
  })
  if (!clienteFinal) throw new NotFoundError('ClienteFinal não encontrado')

  const existing = await prisma.notificationChannel.findUnique({ where: { clienteFinalId } })
  const instanceName = existing?.instanceName ?? buildInstanceName({
    name: clienteFinal.tradeName ?? clienteFinal.name,
    id:   clienteFinal.id,
  })

  let snapshot = await syncInstance(instanceName)
  let connect:  EvolutionConnectPayload = { pairingCode: null, qrCodePayload: null, count: 0, raw: null }

  if (!snapshot) snapshot = await createInstance(instanceName)

  connect = await connectInstance(instanceName)

  const hasQr = !!(connect.qrCodePayload || connect.pairingCode)
  if (!hasQr && snapshot?.connectionState !== 'open') {
    const restarted = await restartInstance(instanceName)
    snapshot = restarted.snapshot
    connect  = restarted.connect
  }

  const channel = await applySnapshotToChannel(clienteFinalId, instanceName, snapshot, connect)
  logger.info({ clienteFinalId, instanceName }, 'notifications.whatsapp.admin_provisioned')

  configureWebhook(instanceName).catch(() => {/* já logado internamente */})

  res.json({ channel: serializeChannel(channel) })
})
