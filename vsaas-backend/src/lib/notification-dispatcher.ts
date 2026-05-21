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
import { sendText, sendMedia, normalizePhone } from '../services/evolution.service'
import { sendMail } from './smtp'
import { broadcastSse } from './sse-bus'
import { rateLimitDedup } from '../services/notification-dedup.service'

// TTL por canal (segundos). Override via env DEDUP_TTL_<CHANNEL>_SEC.
// Push/SSE: barulho leve → 5min. WhatsApp: caro+ruidoso → 15min.
// Email: muito ruidoso → 30min. Telegram: intermediário → 10min.
const DEDUP_TTL = {
  push:     Number(process.env.DEDUP_TTL_PUSH_SEC     ?? 300),   // 5min
  telegram: Number(process.env.DEDUP_TTL_TELEGRAM_SEC ?? 600),   // 10min
  whatsapp: Number(process.env.DEDUP_TTL_WHATSAPP_SEC ?? 900),   // 15min
  email:    Number(process.env.DEDUP_TTL_EMAIL_SEC    ?? 1800),  // 30min
}

export interface AlertPayload {
  integradorId: string
  clienteFinalId?: string    // OBRIGATÓRIO para Telegram/WhatsApp (isolamento)
  title: string
  body: string
  cameraName?: string
  cameraId?: string          // habilita "Reproduzir" instantâneo no popup SSE
  snapshot?: string          // base64 WebP
  severity?: 'INFO' | 'WARNING' | 'CRITICAL'
  eventId?: string
  /**
   * Chave de dedup por canal (ex: 'semantic-rule:<ruleId>').
   * Se omitido, usa eventId ou cameraId+severity como fallback.
   * Cada canal tem TTL próprio (push 5min, whatsapp 15min, email 30min).
   */
  dedupKey?: string
  /** Escopo de dedup (default 'alert'). Permite separar tipos: lpr | semantic-rule | etc. */
  dedupScope?: string
}

interface DispatchResult {
  webpush:  { sent: number; failed: number }
  telegram: { sent: number; failed: number }
  whatsapp: { sent: number; failed: number }
  email:    { sent: number; failed: number }
  sse:      { sent: number }     // popup em tempo real no painel aberto
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
    email:    { sent: 0, failed: 0 },
    sse:      { sent: 0 },
  }

  // Chave de dedup base. Se chamador não passar, deriva do contexto disponível.
  const dedupKey = alert.dedupKey
    ?? alert.eventId
    ?? `${alert.cameraId ?? 'no-cam'}-${alert.severity ?? 'INFO'}`
  const dedupScope = alert.dedupScope ?? 'alert'

  // Override por cliente (NotificationChannel.dedup*Sec). Resolve uma única vez.
  let clientDedupOverride: Partial<Record<keyof typeof DEDUP_TTL, number>> = {}
  if (alert.clienteFinalId) {
    const channel = await prisma.notificationChannel.findUnique({
      where: { clienteFinalId: alert.clienteFinalId },
      select: { dedupPushSec: true, dedupTelegramSec: true, dedupWhatsappSec: true, dedupEmailSec: true },
    }).catch(() => null)
    if (channel) {
      if (channel.dedupPushSec     != null) clientDedupOverride.push     = channel.dedupPushSec
      if (channel.dedupTelegramSec != null) clientDedupOverride.telegram = channel.dedupTelegramSec
      if (channel.dedupWhatsappSec != null) clientDedupOverride.whatsapp = channel.dedupWhatsappSec
      if (channel.dedupEmailSec    != null) clientDedupOverride.email    = channel.dedupEmailSec
    }
  }

  /**
   * Verifica se o canal pode notificar (respeita TTL próprio).
   * Retorna true se passou; false se foi suprimido por dedup recente.
   * Prioridade: override por cliente > env default global.
   * TTL=0 desativa dedup (envia todo disparo).
   */
  async function canSend(channel: keyof typeof DEDUP_TTL): Promise<boolean> {
    const ttl = clientDedupOverride[channel] ?? DEDUP_TTL[channel]
    if (ttl <= 0) return true  // dedup desligado pelo cliente
    return rateLimitDedup({
      scope:   dedupScope,
      key:     dedupKey,
      channel,
      ttlSec:  ttl,
    })
  }

  // ── 0. SSE — popup em tempo real no painel aberto ─────────────────────
  // Roda primeiro porque é instantâneo (sub-100ms) e dá feedback ao operador
  // antes do WhatsApp/Email demorarem.
  try {
    result.sse.sent = broadcastSse(
      { integradorId: alert.integradorId, clienteFinalId: alert.clienteFinalId },
      {
        type:       'alert',
        severity:   alert.severity ?? 'INFO',
        title:      alert.title,
        body:       alert.body,
        cameraName: alert.cameraName,
        cameraId:   alert.cameraId,
        snapshot:   alert.snapshot,
        eventId:    alert.eventId,
        ts:         Date.now(),
      },
    )
  } catch (err: any) {
    logger.warn({ err: err.message }, 'dispatch_sse_error')
  }

  // ── 1. WebPush (broadcast para subscriptions do integrador) ───────────
  if (!(await canSend('push'))) {
    logger.info({ dedupKey, channel: 'push' }, 'dispatch_dedup_skipped')
  } else try {
    const wpResult = await webpushBroadcast(
      { integradorId: alert.integradorId },
      {
        title: alert.title,
        body: alert.body,
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-72.png',
        tag: `iacv-${alert.severity ?? 'INFO'}`,
        // Deep link: abre câmera específica no app mobile quando disponível
        url: alert.cameraId
          ? `/mobile/cameras?open=${encodeURIComponent(alert.cameraId)}`
          : '/mobile/alerts',
        data: { eventId: alert.eventId, cameraId: alert.cameraId, ts: Date.now() },
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
  const telegramOk = await canSend('telegram')
  if (!telegramOk) {
    logger.info({ dedupKey, channel: 'telegram' }, 'dispatch_dedup_skipped')
  } else try {
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
  if (alert.clienteFinalId && !(await canSend('whatsapp'))) {
    logger.info({ dedupKey, channel: 'whatsapp' }, 'dispatch_dedup_skipped')
  } else if (alert.clienteFinalId) {
    try {
      const channel = await prisma.notificationChannel.findUnique({
        where: { clienteFinalId: alert.clienteFinalId },
        select: { instanceName: true, connectionState: true, recipients: true, id: true },
      })

      if (channel && channel.connectionState === 'open' && channel.recipients.length > 0) {
        // Resolve nome do cliente (pra colocar no template).
        const cf = await prisma.clienteFinal.findUnique({
          where: { id: alert.clienteFinalId },
          select: { name: true },
        }).catch(() => null)

        // Template profissional com separadores, severity, link de playback,
        // brand footer. Se houver snapshot → envia como sendMedia (imagem +
        // caption). Senão → sendText.
        const severityLabel = ({
          INFO:     'ℹ️ Informativo',
          WARNING:  '⚠️ Atenção',
          CRITICAL: '🚨 CRÍTICO',
        } as const)[alert.severity ?? 'WARNING'] ?? '⚠️ Atenção'

        const ts = Date.now()
        const dataBrt = new Date(ts).toLocaleString('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        })

        const playbackUrl = alert.cameraId
          ? `https://app.vsaas.com.br/recordings?cameraId=${alert.cameraId}&at=${encodeURIComponent(new Date(ts).toISOString())}`
          : null

        const caption =
`🎯 *${alert.title ?? 'ALERTA — IA Cloud Vision'}*
━━━━━━━━━━━━━━━━━━━━━━

📍 *Cliente:* ${cf?.name ?? '—'}
📷 *Câmera:* ${alert.cameraName ?? '—'}
🔔 *Severidade:* ${severityLabel}
🕒 *Detectado em:* ${dataBrt} BRT

🧠 *Análise da IA:*
_${alert.body}_

${alert.snapshot ? '📸 _Imagem do evento anexa._\n\n' : ''}${playbackUrl ? `🎬 *Acessar gravação:*\n${playbackUrl}\n\n` : ''}━━━━━━━━━━━━━━━━━━━━━━
🤖 *IA Cloud Vision*
_Videomonitoramento inteligente como serviço_
🌐 vsaas.com.br

_Para gerenciar este alerta ou marcar como falso positivo, acesse o portal._`

        for (const phone of channel.recipients) {
          let status: 'sent' | 'failed' = 'sent'
          let evolutionMsgId: string | null = null
          let errorMessage: string | null = null

          try {
            // Com snapshot → sendMedia (imagem + caption). Sem snapshot → sendText.
            const res = (alert.snapshot
              ? await sendMedia(channel.instanceName, phone, alert.snapshot, caption, {
                  mimetype: 'image/jpeg',
                  fileName: `alerta-${alert.cameraId ?? 'cam'}-${ts}.jpg`,
                })
              : await sendText(channel.instanceName, phone, caption)) as any
            evolutionMsgId = res?.key?.id ?? res?.id ?? null
            result.whatsapp.sent++
          } catch (err: any) {
            status       = 'failed'
            errorMessage = err?.message ?? String(err)
            result.whatsapp.failed++
            logger.warn({ phone, err: errorMessage }, 'dispatch_whatsapp_send_failed')
          }

          // Registra no log de mensagens (sem o base64 da imagem — pesado demais)
          await prisma.notificationLog.create({
            data: {
              id:             randomUUID(),
              clienteFinalId: alert.clienteFinalId!,
              instanceName:   channel.instanceName,
              toPhone:        normalizePhone(phone),
              message:        caption,
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

  // ── 4. Email (usuários ativos do clienteFinal com role operacional) ──
  if (alert.clienteFinalId && !(await canSend('email'))) {
    logger.info({ dedupKey, channel: 'email' }, 'dispatch_dedup_skipped')
  } else if (alert.clienteFinalId) {
    try {
      const recipients = await prisma.user.findMany({
        where: {
          clienteFinalId: alert.clienteFinalId,
          active:         { not: false },

        },
        select: { email: true, name: true },
      })

      if (recipients.length > 0) {
        const subject = `[IACV ${alert.severity ?? 'INFO'}] ${alert.title}`
        const text =
          `${alert.title}\n\n${alert.body}\n` +
          (alert.cameraName ? `Câmera: ${alert.cameraName}\n` : '') +
          (alert.eventId ? `Evento: ${alert.eventId}\n` : '') +
          `\nAcesse o painel para mais detalhes.\n`

        const html = `
          <div style="font-family:Arial,sans-serif;max-width:560px">
            <h2 style="color:${alert.severity === 'CRITICAL' ? '#dc2626' : alert.severity === 'WARNING' ? '#f59e0b' : '#0ea5e9'}">${escapeHtml(alert.title)}</h2>
            <p>${escapeHtml(alert.body)}</p>
            ${alert.cameraName ? `<p><b>Câmera:</b> ${escapeHtml(alert.cameraName)}</p>` : ''}
            ${alert.snapshot ? `<img src="data:image/webp;base64,${alert.snapshot}" alt="snapshot" style="max-width:100%;border-radius:8px"/>` : ''}
            <hr/>
            <p style="font-size:12px;color:#888">Notificação automática do VSaaS.</p>
          </div>`

        for (const u of recipients) {
          if (!u.email) continue
          const r = await sendMail({ to: u.email, subject, text, html })
          if (r.sent) result.email.sent++
          else result.email.failed++
        }
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'dispatch_email_error')
    }
  }

  if (result.sse.sent + result.webpush.sent + result.telegram.sent + result.whatsapp.sent + result.email.sent > 0) {
    logger.info(
      {
        sse:   result.sse.sent,
        wp:    result.webpush.sent,
        tg:    result.telegram.sent,
        wa:    result.whatsapp.sent,
        email: result.email.sent,
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
