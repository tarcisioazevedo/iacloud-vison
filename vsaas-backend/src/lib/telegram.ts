/**
 * Telegram Bot API — Wrapper nativo MULTI-TENANT.
 *
 * Cada Integrador/ClienteFinal tem seu próprio bot (token no banco).
 * NÃO usamos ENV global — o token vem do DB por tenant.
 *
 * Funções:
 *   1. sendMessage  → alerta texto
 *   2. sendPhoto    → snapshot com caption
 *   3. getMe        → health check do bot
 */
import { logger } from './logger'

const API_BASE = 'https://api.telegram.org/bot'

/** Health check — retorna nome do bot ou null. */
export async function telegramGetMe(botToken: string): Promise<string | null> {
  if (!botToken || botToken.length < 20) return null
  try {
    const r = await fetch(`${API_BASE}${botToken}/getMe`, { signal: AbortSignal.timeout(5000) })
    const data = await r.json() as any
    return data.ok ? `@${data.result.username}` : null
  } catch {
    return null
  }
}

/**
 * Envia mensagem de texto para um chatId usando o bot do tenant.
 */
export async function telegramSendMessage(
  botToken: string,
  chatId: string,
  text: string,
  opts: { parseMode?: 'MarkdownV2' | 'HTML' } = {},
): Promise<boolean> {
  if (!botToken || botToken.length < 20) {
    logger.debug('telegram_no_token — skipping sendMessage')
    return false
  }

  try {
    const r = await fetch(`${API_BASE}${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: opts.parseMode ?? 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    const data = await r.json() as any
    if (!data.ok) {
      logger.warn({ chatId, error: data.description }, 'telegram_send_failed')
      return false
    }
    return true
  } catch (err: any) {
    logger.warn({ chatId, err: err.message }, 'telegram_send_error')
    return false
  }
}

/**
 * Envia foto (snapshot WebP base64) com caption.
 */
export async function telegramSendSnapshot(
  botToken: string,
  chatId: string,
  base64Webp: string,
  caption: string,
): Promise<boolean> {
  if (!botToken || botToken.length < 20) return false

  try {
    const buffer = Buffer.from(base64Webp, 'base64')
    const blob = new Blob([buffer], { type: 'image/webp' })

    const form = new FormData()
    form.append('chat_id', chatId)
    form.append('photo', blob, 'snapshot.webp')
    form.append('caption', caption)
    form.append('parse_mode', 'HTML')

    const r = await fetch(`${API_BASE}${botToken}/sendPhoto`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(15_000),
    })
    const data = await r.json() as any
    if (!data.ok) {
      logger.warn({ chatId, error: data.description }, 'telegram_photo_failed')
      return false
    }
    return true
  } catch (err: any) {
    logger.warn({ chatId, err: err.message }, 'telegram_photo_error')
    return false
  }
}
