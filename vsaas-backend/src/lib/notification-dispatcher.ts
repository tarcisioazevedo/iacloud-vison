/**
 * NotificationDispatcher — Fan-out de alertas MULTI-TENANT.
 *
 * Regra de negócio B2B2B:
 *   - Cada ClienteFinal tem seu PRÓPRIO bot Telegram (token isolado no banco).
 *   - Os alertas vão APENAS para os chatIds configurados por aquele ClienteFinal.
 *   - Dados NUNCA vazam entre tenants.
 *
 * Canais suportados:
 *   1. WebPush (VAPID)   — por integradorId (subscriptions do painel)
 *   2. Telegram Bot      — por clienteFinalId (bot + chatIds do cliente)
 *   3. Users individuais — cada user com telegramChatId recebe do bot do SEU cliente
 *   4. WhatsApp Evolution — por clienteFinalId (instância + recipients[])
 */
import { randomUUID } from 'crypto'
import { logger } from './logger'
import { prisma } from './prisma'
import { broadcast as webpushBroadcast } from './webpush'
import {
  telegramSendMessage,
  telegramSendSnapshot,
} from './telegram'
import { sendText, normalizePhone } from '../services/evolution.service'

export interface AlertPayload {
  integradorId: string
  clienteFinalId?: string    // OBRIGATÓRIO para Telegram/WhatsApp (isolamento)
  title: string
  body: string
  cameraName?: string
  snapshot?: string          // base64 WebP
  severity?: 'INFO' | 'WARNING' | 'CRITICAL'
  eventId?: string
}

interface DispatchResult {
  webpush:  { sent: number; failed: number }
  telegram: { sent: number; failed: number }
  whatsapp: { sent: number; failed: number }
}

/**
 * Envia alerta respeitando isolamento multi-tenant.
 * Telegram usa o bot do ClienteFinal — nunca do integrador.
 */
export async function dispatchAlert(alert: AlertPayload): Promise<DispatchResult> {
  const result: DispatchResult = {
    webpush:  { sent: 0, failed: 0 },
    telegram: { sent: 0, failed: 0 },
    whatsapp: { sent: 0, failed: 0 },
  }

  // ── 1. WebPush (broadcast para subscriptions do integrador) ───────────
  try {
    const wpResult = await webpushBroadcast(
      { integradorId: alert.integradorId },
      {
        title: alert.title,
        body: alert.body,
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-72.png',
        tag: `iacv-${alert.severity ?? 'INFO'}`,
        url: '/events',
        data: { eventId: alert.eventId, ts: Date.now() },
      },
    )
    result.webpush.sent = wpResult.sent
    result.webpush.failed = wpResult.failed + wpResult.expired
  } catch (err: any) {
    logger.warn({ err: err.message }, 'dispatch_webpush_error')
  }

  // ── 2. Telegram (bot do ClienteFinal — isolamento total) ──────────────
  if (!alert.clienteFinalId) {
    // Sem clienteFinalId, não dá pra saber qual bot usar → skip Telegram
    logger.debug('dispatch_telegram_skip: no clienteFinalId')
    return result
  }

  try {
    // Buscar o bot token e chatIds do CLIENTE FINAL (não do integrador!)
    const cliente = await prisma.clienteFinal.findUnique({
      where: { id: alert.clienteFinalId },
      select: {
        telegramBotToken: true,
        telegramChatIds: true,
      },
    })

    const botToken = cliente?.telegramBotToken
    if (!botToken || botToken.length < 20) {
      // Cliente não configurou Telegram → ok, silencioso
      return result
    }

    const chatIds = cliente.telegramChatIds ?? []

    // 2a. Enviar para os grupos/canais configurados pelo cliente
    for (const chatId of chatIds) {
      try {
        let ok = false
        if (alert.snapshot) {
          const caption = `<b>${escapeHtml(alert.title)}</b>\n${escapeHtml(alert.body)}`
          ok = await telegramSendSnapshot(botToken, chatId, alert.snapshot, caption)
        } else {
          const text = `<b>${escapeHtml(alert.title)}</b>\n\n${escapeHtml(alert.body)}`
          ok = await telegramSendMessage(botToken, chatId, text)
        }
        if (ok) result.telegram.sent++
        else result.telegram.failed++
      } catch {
        result.telegram.failed++
      }
    }

    // 2b. Enviar para users individuais DESTE cliente com telegramChatId
    const users = await prisma.user.findMany({
      where: {
        clienteFinalId: alert.clienteFinalId,
        telegramChatId: { not: null },
        active: { not: false },
      },
      select: { telegramChatId: true },
    })

    for (const user of users) {
      if (!user.telegramChatId) continue
      // Evitar duplicata se o chatId do user já está na lista do cliente
      if (chatIds.includes(user.telegramChatId)) continue

      try {
        const text = `<b>${escapeHtml(alert.title)}</b>\n\n${escapeHtml(alert.body)}`
        const ok = await telegramSendMessage(botToken, user.telegramChatId, text)
        if (ok) result.telegram.sent++
        else result.telegram.failed++
      } catch {
        result.telegram.failed++
      }
    }
  } catch (err: any) {
    logger.warn({ err: err.message }, 'dispatch_telegram_error')
  }

  // ── 3. WhatsApp Evolution (recipients[] do ClienteFinal) ─────────────
  if (alert.clienteFinalId) {
    try {
      const channel = await prisma.notificationChannel.findUnique({
        where: { clienteFinalId: alert.clienteFinalId },
        select: { instanceName: true, connectionState: true, recipients: true, id: true },
      })

      if (channel && channel.connectionState === 'open' && channel.recipients.length > 0) {
        const text = `*${alert.title}*\n\n${alert.body}${alert.cameraName ? `\n📷 ${alert.cameraName}` : ''}`

        for (const phone of channel.recipients) {
          let status: 'sent' | 'failed' = 'sent'
          let evolutionMsgId: string | null = null
          let errorMessage: string | null = null

          try {
            const res = await sendText(channel.instanceName, phone, text) as any
            evolutionMsgId = res?.key?.id ?? res?.id ?? null
            result.whatsapp.sent++
          } catch (err: any) {
            status       = 'failed'
            errorMessage = err?.message ?? String(err)
            result.whatsapp.failed++
          }

          // Registra no log de mensagens (silencioso em caso de falha do log)
          await prisma.notificationLog.create({
            data: {
              id:             randomUUID(),
              clienteFinalId: alert.clienteFinalId!,
              instanceName:   channel.instanceName,
              toPhone:        normalizePhone(phone),
              message:        text,
              status,
              evolutionMsgId,
              errorMessage,
              origin:         'alert',
            },
          }).catch((err: unknown) => logger.warn({ err }, 'dispatch_whatsapp_log_failed'))
        }
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'dispatch_whatsapp_error')
    }
  }

  if (result.webpush.sent + result.telegram.sent + result.whatsapp.sent > 0) {
    logger.info(
      {
        wp:  result.webpush.sent,
        tg:  result.telegram.sent,
        wa:  result.whatsapp.sent,
        eventId: alert.eventId,
      },
      'notification_dispatched',
    )
  }

  return result
}

/** Escapa caracteres especiais para HTML do Telegram. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
