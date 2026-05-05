/**
 * notify.service.ts — Orquestrador único de notificações multi-canal.
 *
 * Responsabilidades:
 *   1. Carregar NotificationPreference do destinatário (cria default se não existir)
 *   2. Filtrar canais por preferência + por evento
 *   3. Aplicar quiet hours (exceto se priority='critical')
 *   4. Aplicar dedupe (mesma dedupeKey em <5min é skip)
 *   5. Fan-out paralelo (push + email + whatsapp + sse)
 *   6. Gravar NotificationDeliveryLog para cada tentativa
 *
 * Filosofia "fail-soft": qualquer canal que falhe não derruba os outros.
 * Erros são logados mas não propagados — gatilho comercial nunca depende de
 * notificação chegar.
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { broadcast as pushBroadcast } from '../lib/webpush'
import { sendMail } from '../lib/smtp'
import { sendText as evolutionSendText, normalizePhone as evolutionNormalizePhone } from './evolution.service'
import { broadcastSse, type SseAlertEvent } from '../lib/sse-bus'
import { createHash } from 'crypto'

export type NotifyEvent =
  | 'NEW_LEAD'
  | 'HOT_LEAD'
  | 'DEMO_APPROVED'
  | 'DEMO_PENDING_OVERDUE'
  | 'LEAD_STALLED'
  | 'LEAD_CONVERTED'
  | 'LEAD_LOST_TO_COMPETITOR'
  | 'LEAD_REASSIGNED'
  | 'GOAL_50_PCT'
  | 'GOAL_100_PCT'
  | 'DAILY_DIGEST'
  | 'TEST'

export type NotifyChannel = 'push' | 'email' | 'whatsapp' | 'sse'

export interface NotifyRecipient {
  userId?: string
  superAdminId?: string
}

export interface NotifyPayload {
  title: string
  body: string
  url?: string                       // deep link no front (ex: /admin/comercial?tab=pipeline)
  data?: Record<string, unknown>     // payload arbitrário p/ push
  emailHtml?: string                 // fallback de body se vazio
  emailSubject?: string              // fallback de title se vazio
  whatsappText?: string              // fallback de body se vazio
}

export interface NotifyOptions {
  event: NotifyEvent
  recipients: NotifyRecipient[]
  payload: NotifyPayload
  priority?: 'normal' | 'critical'   // critical ignora quiet hours
  dedupeKey?: string                 // se mesma key em <DEDUPE_WINDOW_MS, skip
  channels?: NotifyChannel[]         // override do default por evento
}

// ─── Defaults por evento (canais que disparam quando user não personalizou) ──
const DEFAULT_CHANNELS: Record<NotifyEvent, NotifyChannel[]> = {
  NEW_LEAD:                ['push', 'email', 'sse'],
  HOT_LEAD:                ['push', 'whatsapp', 'sse'],
  DEMO_APPROVED:           ['push', 'sse'],
  DEMO_PENDING_OVERDUE:    ['push', 'email'],
  LEAD_STALLED:            ['push', 'email'],
  LEAD_CONVERTED:          ['push', 'email', 'sse'],
  LEAD_LOST_TO_COMPETITOR: ['push', 'email'],
  LEAD_REASSIGNED:         ['push', 'sse'],
  GOAL_50_PCT:             ['push'],
  GOAL_100_PCT:            ['push', 'email'],
  DAILY_DIGEST:            ['email'],
  TEST:                    ['push', 'email', 'whatsapp', 'sse'],
}

const DEDUPE_WINDOW_MS = 5 * 60 * 1000
// Instância Evolution dedicada à equipe IA Cloud Vision (interna).
// Provisionada manualmente (uma vez) com nome fixo abaixo.
const INTERNAL_WHATSAPP_INSTANCE = process.env.NOTIFY_WHATSAPP_INSTANCE ?? 'iacloud_internal'

// ────────────────────────────────────────────────────────────────────────────

interface ResolvedRecipient {
  recipient: NotifyRecipient
  prefs: any   // NotificationPreference
  email: string | null
  phone: string | null
  name: string | null
}

async function resolveRecipient(r: NotifyRecipient): Promise<ResolvedRecipient | null> {
  let email: string | null = null
  let phone: string | null = null
  let name: string | null = null
  let prefs: any | null = null

  if (r.userId) {
    const u = await prisma.user.findUnique({
      where: { id: r.userId },
      select: { email: true, name: true },
    })
    if (!u) return null
    email = u.email; name = u.name
    prefs = await prisma.notificationPreference.findUnique({ where: { userId: r.userId } })
    if (!prefs) {
      prefs = await prisma.notificationPreference.create({ data: { userId: r.userId } })
    }
  } else if (r.superAdminId) {
    const s = await prisma.superAdmin.findUnique({
      where: { id: r.superAdminId },
      select: { email: true, name: true },
    })
    if (!s) return null
    email = s.email; name = s.name
    prefs = await prisma.notificationPreference.findUnique({ where: { superAdminId: r.superAdminId } })
    if (!prefs) {
      prefs = await prisma.notificationPreference.create({ data: { superAdminId: r.superAdminId } })
    }
  } else {
    return null
  }

  // Phone vem só de NotificationPreference.whatsappPhone (User não tem campo phone).
  return { recipient: r, prefs, email, phone: prefs?.whatsappPhone ?? null, name }
}

function isInQuietHours(prefs: any, now = new Date()): boolean {
  const h = now.getHours()
  const start = prefs.quietHoursStart ?? 22
  const end = prefs.quietHoursEnd ?? 7
  // Janela cruza meia-noite (22 → 7) ou normal (10 → 18)
  if (start === end) return false
  if (start > end) return h >= start || h < end
  return h >= start && h < end
}

function resolveChannelsForEvent(event: NotifyEvent, prefs: any, override?: NotifyChannel[]): NotifyChannel[] {
  if (override) return override
  const eventMap = (prefs?.eventChannels ?? {}) as Record<string, NotifyChannel[]>
  return eventMap[event] ?? DEFAULT_CHANNELS[event] ?? ['push']
}

function channelEnabledByPrefs(channel: NotifyChannel, prefs: any): boolean {
  if (channel === 'sse') return true   // SSE sempre tenta — popup leve, sem custo
  if (channel === 'push') return prefs.pushEnabled !== false
  if (channel === 'email') return prefs.emailEnabled !== false
  if (channel === 'whatsapp') return prefs.whatsappEnabled === true
  return false
}

async function isDeduped(dedupeKey: string): Promise<boolean> {
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS)
  const recent = await prisma.notificationDeliveryLog.findFirst({
    where: { dedupeKey, status: 'sent', createdAt: { gte: since } },
    select: { id: true },
  })
  return !!recent
}

async function logDelivery(args: {
  recipient: NotifyRecipient
  event: NotifyEvent
  channel: NotifyChannel
  status: 'sent' | 'failed' | 'skipped_pref' | 'skipped_quiet' | 'deduped'
  dedupeKey?: string
  payload?: Record<string, unknown>
  errorMsg?: string
}): Promise<void> {
  try {
    await prisma.notificationDeliveryLog.create({
      data: {
        recipientUserId:        args.recipient.userId ?? null,
        recipientSuperAdminId:  args.recipient.superAdminId ?? null,
        event:                  args.event,
        channel:                args.channel,
        status:                 args.status,
        dedupeKey:              args.dedupeKey ?? null,
        payloadJson:            (args.payload ?? null) as any,
        errorMsg:               args.errorMsg ?? null,
      },
    })
  } catch (err: any) {
    logger.warn({ err: err.message }, 'notification_log_persist_failed')
  }
}

// ─── Senders por canal ─────────────────────────────────────────────────────

async function sendPush(rr: ResolvedRecipient, payload: NotifyPayload): Promise<{ ok: boolean; err?: string }> {
  try {
    const res = await pushBroadcast(
      {
        userId: rr.recipient.userId,
        superAdminId: rr.recipient.superAdminId,
      },
      {
        title: payload.title,
        body: payload.body,
        url: payload.url,
        data: payload.data,
        tag: `icv-${payload.url ?? 'notify'}`,
      },
    )
    return { ok: res.sent > 0 || (res.sent === 0 && res.failed === 0 && res.expired === 0) }
  } catch (err: any) {
    return { ok: false, err: err?.message ?? String(err) }
  }
}

async function sendEmail(rr: ResolvedRecipient, payload: NotifyPayload): Promise<{ ok: boolean; err?: string }> {
  if (!rr.email) return { ok: false, err: 'destinatário sem email' }
  const subject = payload.emailSubject ?? `[IA Cloud Vision] ${payload.title}`
  const text = payload.body + (payload.url ? `\n\nAbra: ${frontUrlOf(payload.url)}` : '')
  const html = payload.emailHtml ?? renderHtml(payload, rr.name ?? '')
  const r = await sendMail({ to: rr.email, subject, text, html })
  return { ok: r.sent, err: r.reason }
}

async function sendWhatsapp(rr: ResolvedRecipient, payload: NotifyPayload): Promise<{ ok: boolean; err?: string }> {
  if (!rr.phone) return { ok: false, err: 'sem telefone cadastrado' }
  const phone = evolutionNormalizePhone(rr.phone)
  const text = payload.whatsappText
    ?? `*${payload.title}*\n\n${payload.body}${payload.url ? `\n\n${frontUrlOf(payload.url)}` : ''}`
  try {
    await evolutionSendText(INTERNAL_WHATSAPP_INSTANCE, phone, text)
    return { ok: true }
  } catch (err: any) {
    return { ok: false, err: err?.message ?? String(err) }
  }
}

function sendSseEvent(rr: ResolvedRecipient, payload: NotifyPayload, event: NotifyEvent): { ok: boolean } {
  const sseEvent: SseAlertEvent = {
    type: 'alert',
    severity: event === 'HOT_LEAD' || event === 'DEMO_PENDING_OVERDUE' ? 'CRITICAL'
            : event.startsWith('LEAD_') ? 'WARNING'
            : 'INFO',
    title: payload.title,
    body: payload.body,
    ts: Date.now(),
  }
  const sent = broadcastSse({ userId: rr.recipient.userId }, sseEvent)
  return { ok: sent > 0 }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function frontUrlOf(path: string): string {
  const base = (process.env.PUBLIC_FRONTEND_URL ?? 'https://app.iacloud.com.br').replace(/\/login$/, '').replace(/\/$/, '')
  if (path.startsWith('http')) return path
  return base + (path.startsWith('/') ? path : '/' + path)
}

function renderHtml(payload: NotifyPayload, name: string): string {
  const url = payload.url ? frontUrlOf(payload.url) : ''
  const cta = url
    ? `<p style="margin: 16px 0;"><a href="${url}" style="display:inline-block;padding:10px 18px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">Abrir no Hub Comercial</a></p>`
    : ''
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:20px;">
    <div style="max-width:560px;margin:0 auto;background:#1e293b;border-radius:8px;padding:24px;">
      <h2 style="margin:0 0 8px;color:#fff;">${escapeHtml(payload.title)}</h2>
      ${name ? `<p style="color:#94a3b8;font-size:13px;margin:0 0 16px;">Olá ${escapeHtml(name.split(' ')[0])},</p>` : ''}
      <p style="color:#cbd5e1;line-height:1.5;white-space:pre-wrap;">${escapeHtml(payload.body)}</p>
      ${cta}
      <hr style="border:none;border-top:1px solid #334155;margin:24px 0;">
      <p style="color:#64748b;font-size:11px;">IA Cloud Vision — você está recebendo porque está cadastrado na equipe comercial.<br>
      Para alterar preferências, acesse Configurações → Notificações no Hub.</p>
    </div></body></html>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!))
}

function buildDedupeKey(opts: NotifyOptions, recipient: NotifyRecipient): string {
  const id = recipient.userId ?? recipient.superAdminId ?? 'anon'
  const base = opts.dedupeKey ?? `${opts.event}:${id}:${opts.payload.url ?? ''}`
  return createHash('sha1').update(base).digest('hex').slice(0, 16)
}

// ─── API pública ───────────────────────────────────────────────────────────

export async function notify(opts: NotifyOptions): Promise<{
  recipients: number
  sentByChannel: Record<NotifyChannel, number>
  skipped: number
  failed: number
}> {
  const sentByChannel: Record<NotifyChannel, number> = { push: 0, email: 0, whatsapp: 0, sse: 0 }
  let skipped = 0
  let failed = 0
  const isCritical = opts.priority === 'critical'

  const resolved = await Promise.all(opts.recipients.map(resolveRecipient))
  const validRecipients = resolved.filter(Boolean) as ResolvedRecipient[]

  for (const rr of validRecipients) {
    const dedupeKey = buildDedupeKey(opts, rr.recipient)
    const channels = resolveChannelsForEvent(opts.event, rr.prefs, opts.channels)

    for (const channel of channels) {
      // 1) preferência do canal
      if (!channelEnabledByPrefs(channel, rr.prefs)) {
        await logDelivery({ recipient: rr.recipient, event: opts.event, channel, status: 'skipped_pref', dedupeKey })
        skipped++; continue
      }

      // 2) quiet hours (exceto critical e SSE)
      if (!isCritical && channel !== 'sse' && isInQuietHours(rr.prefs)) {
        await logDelivery({ recipient: rr.recipient, event: opts.event, channel, status: 'skipped_quiet', dedupeKey })
        skipped++; continue
      }

      // 3) dedupe (apenas para canais persistentes — SSE é live, sempre vai)
      if (channel !== 'sse' && await isDeduped(dedupeKey)) {
        await logDelivery({ recipient: rr.recipient, event: opts.event, channel, status: 'deduped', dedupeKey })
        skipped++; continue
      }

      // 4) envio
      let result: { ok: boolean; err?: string }
      try {
        if (channel === 'push')      result = await sendPush(rr, opts.payload)
        else if (channel === 'email') result = await sendEmail(rr, opts.payload)
        else if (channel === 'whatsapp') result = await sendWhatsapp(rr, opts.payload)
        else                              result = sendSseEvent(rr, opts.payload, opts.event)
      } catch (err: any) {
        result = { ok: false, err: err?.message ?? String(err) }
      }

      if (result.ok) {
        sentByChannel[channel]++
        await logDelivery({
          recipient: rr.recipient, event: opts.event, channel,
          status: 'sent', dedupeKey, payload: { title: opts.payload.title, url: opts.payload.url },
        })
      } else {
        failed++
        await logDelivery({
          recipient: rr.recipient, event: opts.event, channel,
          status: 'failed', dedupeKey, errorMsg: result.err,
        })
      }
    }
  }

  logger.info({
    event: opts.event, recipients: validRecipients.length, sentByChannel, skipped, failed,
  }, 'notification_dispatched')

  return { recipients: validRecipients.length, sentByChannel, skipped, failed }
}

// ─── Helpers de roteamento (quem recebe o quê) ─────────────────────────────

/** Resolve o User dono do lead (assignedToUserId). Devolve recipient ou null. */
export async function recipientFromLeadOwner(leadId: string): Promise<NotifyRecipient | null> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { assignedToUserId: true },
  })
  if (!lead?.assignedToUserId) return null
  return { userId: lead.assignedToUserId }
}

/** Resolve gerentes/diretores comerciais como recipients (para escalações). */
export async function recipientsManagersAndDirectors(): Promise<NotifyRecipient[]> {
  const managers = await prisma.salesUser.findMany({
    where: { role: { in: ['MANAGER', 'DIRECTOR'] }, active: true },
    select: { userId: true },
  })
  return managers.map(m => ({ userId: m.userId }))
}

/** Todos os SuperAdmins ativos — usado em eventos sistêmicos críticos. */
export async function recipientsAllSuperAdmins(): Promise<NotifyRecipient[]> {
  const sa = await prisma.superAdmin.findMany({
    where: { active: true },
    select: { id: true },
  })
  return sa.map(s => ({ superAdminId: s.id }))
}
