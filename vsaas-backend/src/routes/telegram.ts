/**
 * Telegram Integration Routes — Multi-tenant (por ClienteFinal).
 *
 * Cada Cliente Final configura seu PRÓPRIO bot Telegram.
 * O integrador NÃO compartilha bot com seus clientes.
 *
 *   GET    /telegram/status             → verifica se o cliente tem bot configurado
 *   POST   /telegram/bot-token          → salva/atualiza o bot token do cliente
 *   DELETE /telegram/bot-token          → remove o bot token
 *   POST   /telegram/chat-ids           → adiciona um chatId
 *   DELETE /telegram/chat-ids/:chatId   → remove um chatId
 *   POST   /telegram/test               → envia mensagem de teste
 *   POST   /telegram/link-user          → user individual conecta seu Telegram
 *   DELETE /telegram/link-user          → user desconecta
 */
import { Router, Request, Response } from 'express'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { requireAuth } from '../middleware/auth'
import { telegramGetMe, telegramSendMessage } from '../lib/telegram'

export const telegramRouter = Router()
telegramRouter.use(requireAuth)

/**
 * Resolve o clienteFinalId do JWT (user pode ser do integrador ou do cliente).
 * Se for integrador, precisa passar clienteFinalId no query/body.
 */
async function resolveClienteFinalId(req: Request): Promise<string | null> {
  const jwt = req.jwtPayload!
  // Se o user é de um ClienteFinal → direto
  if (jwt.clienteFinalId) return jwt.clienteFinalId
  // Se é integrador/super_admin → precisa informar qual cliente
  const cfId = (req.query.clienteFinalId ?? req.body?.clienteFinalId) as string | undefined
  return cfId ?? null
}

// ─── GET /telegram/status ──────────────────────────────────────────────────

telegramRouter.get('/status', async (req: Request, res: Response) => {
  const cfId = await resolveClienteFinalId(req)
  if (!cfId) {
    res.status(400).json({ error: 'MISSING_CLIENTE_FINAL', message: 'Informe clienteFinalId.' })
    return
  }

  const cliente = await prisma.clienteFinal.findUnique({
    where: { id: cfId },
    select: { telegramBotToken: true, telegramChatIds: true },
  })

  const hasToken = !!cliente?.telegramBotToken && cliente.telegramBotToken.length > 20
  let botName: string | null = null
  if (hasToken) {
    botName = await telegramGetMe(cliente!.telegramBotToken!)
  }

  // Buscar users deste cliente que conectaram Telegram
  const usersWithTelegram = await prisma.user.count({
    where: { clienteFinalId: cfId, telegramChatId: { not: null } },
  })

  res.json({
    configured: hasToken,
    botName,
    chatIds: cliente?.telegramChatIds ?? [],
    usersConnected: usersWithTelegram,
  })
})

// ─── POST /telegram/bot-token ──────────────────────────────────────────────

telegramRouter.post('/bot-token', async (req: Request, res: Response) => {
  const cfId = await resolveClienteFinalId(req)
  if (!cfId) { res.status(400).json({ error: 'MISSING_CLIENTE_FINAL' }); return }

  const { botToken } = req.body as { botToken?: string }
  if (!botToken || botToken.length < 20) {
    res.status(400).json({ error: 'INVALID_TOKEN', message: 'Token inválido. Use o formato do @BotFather.' })
    return
  }

  // Validar o token
  const botName = await telegramGetMe(botToken)
  if (!botName) {
    res.status(400).json({ error: 'TOKEN_INVALID', message: 'Token não reconhecido pelo Telegram. Verifique no @BotFather.' })
    return
  }

  await prisma.clienteFinal.update({
    where: { id: cfId },
    data: { telegramBotToken: botToken },
  })

  logger.info({ clienteFinalId: cfId, botName }, 'telegram_bot_configured')
  res.json({ configured: true, botName })
})

// ─── DELETE /telegram/bot-token ────────────────────────────────────────────

telegramRouter.delete('/bot-token', async (req: Request, res: Response) => {
  const cfId = await resolveClienteFinalId(req)
  if (!cfId) { res.status(400).json({ error: 'MISSING_CLIENTE_FINAL' }); return }

  await prisma.clienteFinal.update({
    where: { id: cfId },
    data: { telegramBotToken: null, telegramChatIds: [] },
  })

  logger.info({ clienteFinalId: cfId }, 'telegram_bot_removed')
  res.json({ configured: false })
})

// ─── POST /telegram/chat-ids ───────────────────────────────────────────────

telegramRouter.post('/chat-ids', async (req: Request, res: Response) => {
  const cfId = await resolveClienteFinalId(req)
  if (!cfId) { res.status(400).json({ error: 'MISSING_CLIENTE_FINAL' }); return }

  const { chatId } = req.body as { chatId?: string }
  if (!chatId || chatId.trim().length === 0) {
    res.status(400).json({ error: 'MISSING_CHAT_ID' })
    return
  }

  const cliente = await prisma.clienteFinal.findUnique({
    where: { id: cfId },
    select: { telegramChatIds: true },
  })

  const current = cliente?.telegramChatIds ?? []
  if (current.includes(chatId.trim())) {
    res.status(409).json({ error: 'ALREADY_EXISTS', message: 'Chat ID já adicionado.' })
    return
  }

  await prisma.clienteFinal.update({
    where: { id: cfId },
    data: { telegramChatIds: [...current, chatId.trim()] },
  })

  res.json({ chatIds: [...current, chatId.trim()] })
})

// ─── DELETE /telegram/chat-ids/:chatId ─────────────────────────────────────

telegramRouter.delete('/chat-ids/:chatId', async (req: Request, res: Response) => {
  const cfId = await resolveClienteFinalId(req)
  if (!cfId) { res.status(400).json({ error: 'MISSING_CLIENTE_FINAL' }); return }

  const chatId = decodeURIComponent(req.params.chatId)

  const cliente = await prisma.clienteFinal.findUnique({
    where: { id: cfId },
    select: { telegramChatIds: true },
  })

  const updated = (cliente?.telegramChatIds ?? []).filter(id => id !== chatId)
  await prisma.clienteFinal.update({
    where: { id: cfId },
    data: { telegramChatIds: updated },
  })

  res.json({ chatIds: updated })
})

// ─── POST /telegram/test ───────────────────────────────────────────────────

telegramRouter.post('/test', async (req: Request, res: Response) => {
  const cfId = await resolveClienteFinalId(req)
  if (!cfId) { res.status(400).json({ error: 'MISSING_CLIENTE_FINAL' }); return }

  const cliente = await prisma.clienteFinal.findUnique({
    where: { id: cfId },
    select: { telegramBotToken: true, telegramChatIds: true, name: true },
  })

  if (!cliente?.telegramBotToken) {
    res.status(400).json({ error: 'NO_BOT_TOKEN', message: 'Configure o Bot Token primeiro.' })
    return
  }

  const chatIds = cliente.telegramChatIds ?? []
  if (chatIds.length === 0) {
    res.status(400).json({ error: 'NO_CHAT_IDS', message: 'Adicione ao menos um Chat ID.' })
    return
  }

  let sent = 0, failed = 0
  for (const chatId of chatIds) {
    const ok = await telegramSendMessage(
      cliente.telegramBotToken,
      chatId,
      `✅ <b>IA Cloud Vision — Teste</b>\n\nCliente: <b>${cliente.name}</b>\nMensagem de teste recebida com sucesso.`,
    )
    if (ok) sent++
    else failed++
  }

  res.json({ sent, failed, total: chatIds.length })
})

// ─── POST /telegram/link-user ──────────────────────────────────────────────
// User individual conecta seu Telegram pessoal

telegramRouter.post('/link-user', async (req: Request, res: Response) => {
  const userId = req.jwtPayload!.sub
  const { chatId } = req.body as { chatId?: string }

  if (!chatId || chatId.trim().length === 0) {
    res.status(400).json({ error: 'MISSING_CHAT_ID' })
    return
  }

  await prisma.user.update({
    where: { id: userId },
    data: { telegramChatId: chatId.trim() },
  })

  // Enviar confirmação usando o bot do ClienteFinal do user
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      clienteFinalId: true,
      clienteFinal: { select: { telegramBotToken: true } },
    },
  })

  if (user?.clienteFinal?.telegramBotToken) {
    await telegramSendMessage(
      user.clienteFinal.telegramBotToken,
      chatId.trim(),
      '✅ <b>IA Cloud Vision conectado!</b>\n\nVocê receberá alertas de detecção aqui.',
    )
  }

  logger.info({ userId, chatId: chatId.trim() }, 'telegram_user_linked')
  res.json({ connected: true })
})

// ─── DELETE /telegram/link-user ────────────────────────────────────────────

telegramRouter.delete('/link-user', async (req: Request, res: Response) => {
  const userId = req.jwtPayload!.sub
  await prisma.user.update({
    where: { id: userId },
    data: { telegramChatId: null },
  })
  logger.info({ userId }, 'telegram_user_unlinked')
  res.json({ connected: false })
})
