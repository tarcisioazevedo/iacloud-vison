/**
 * alert.service.ts — Dispatcher central de alertas por e-mail.
 *
 * Responsabilidades:
 *   - Resolver destinatários do tenant (ClienteFinal + escalada para Integrador)
 *   - Aplicar filtros: severity, tipo de evento, janela silenciosa, cooldown
 *   - Limites anti-spam: maxEmailsPerHour / maxEmailsPerDay por ClienteFinal
 *   - Renderizar template e enviar via lib/smtp.ts
 *   - Gravar AlertDelivery (rastreamento + dedup)
 *
 * Uso:
 *   import { alertService } from './alert.service'
 *   await alertService.dispatch({ type: 'CAMERA_DOWN', ... })
 */

import { prisma }                          from '../lib/prisma'
import { logger }                          from '../lib/logger'
import { loadTemplate, renderTemplate, sendMail } from '../lib/smtp'

// ── Tipos públicos ────────────────────────────────────────────────────────────

export type AlertEventType =
  | 'CAMERA_DOWN'
  | 'CAMERA_UP'
  | 'TRIGGER_FIRE'
  | 'DIGEST'
  // Câmera enabled+EDGE_BOX parou de subir segments (>3min sem upload).
  // Diferente de CAMERA_DOWN: a box pode estar online mas o uploader/ffmpeg
  // morreu, ou o RTSP local da câmera quebrou, sem afetar heartbeat.
  | 'CAMERA_NO_UPLOAD'
  | 'CAMERA_UPLOAD_RECOVERED'
  // Box ficou >7d sem heartbeat → status SUSPENDED (rejeita uploads).
  // Operador precisa reativar manualmente.
  | 'BOX_SUSPENDED'
export type AlertSeverity  = 'INFO' | 'WARNING' | 'CRITICAL'

export interface AlertEvent {
  type:            AlertEventType
  severity:        AlertSeverity
  clienteFinalId:  string
  cameraId?:       string
  triggerId?:      string
  /** Chave de deduplicação. Ex: "camera_down:cam-uuid" */
  alertKey:        string
  /** Variáveis para substituição no template */
  payload:         Record<string, string>
  /** Cooldown em segundos (sobrescreve config). Padrão lido do AlertConfig */
  cooldownSecOverride?: number
}

// ── Template mapping ──────────────────────────────────────────────────────────

const EVENT_TEMPLATE: Record<AlertEventType, string> = {
  CAMERA_DOWN:  'camera_down',
  CAMERA_UP:    'camera_up',
  TRIGGER_FIRE: 'alert',
  DIGEST:       'alert_digest',
  CAMERA_NO_UPLOAD:        'camera_no_upload',
  CAMERA_UPLOAD_RECOVERED: 'camera_upload_recovered',
  BOX_SUSPENDED:           'box_suspended',
}

// ── Helpers de tempo ──────────────────────────────────────────────────────────

function isInQuietWindow(start: string | null, end: string | null, tz: string): boolean {
  if (!start || !end) return false
  try {
    const now  = new Date()
    const hhmm = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz })
    const [hh, mm] = hhmm.split(':').map(Number)
    const cur = hh * 60 + mm

    const [sh, sm] = start.split(':').map(Number)
    const [eh, em] = end.split(':').map(Number)
    const s = sh * 60 + sm
    const e = eh * 60 + em

    // Janela que cruza meia-noite (ex: 22:00 → 07:00)
    if (s > e) return cur >= s || cur < e
    return cur >= s && cur < e
  } catch { return false }
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

async function dispatch(event: AlertEvent): Promise<void> {
  const { type, severity, clienteFinalId, alertKey, payload } = event

  // 1. Carrega config do tenant (cooldowns, limites, etc.)
  const config = await prisma.alertConfig.findUnique({
    where: { clienteFinalId },
  })

  const defaultCooldowns: Record<AlertEventType, number> = {
    CAMERA_DOWN:  config?.cooldownCameraDown  ?? 3600,
    CAMERA_UP:    config?.cooldownCameraUp    ?? 600,
    TRIGGER_FIRE: config?.cooldownTrigger     ?? 300,
    DIGEST:       86400,
    // Mesmo cooldown de CAMERA_DOWN/UP — se a câmera fica oscilando,
    // não inundar o operador com 1 alerta por minuto.
    CAMERA_NO_UPLOAD:        config?.cooldownCameraDown ?? 3600,
    CAMERA_UPLOAD_RECOVERED: config?.cooldownCameraUp   ?? 600,
    // Suspensão é evento raro — cooldown longo evita re-alerta acidental
    BOX_SUSPENDED:           24 * 60 * 60,
  }
  const cooldownSec = event.cooldownSecOverride ?? defaultCooldowns[type]

  // 2. Carrega template
  const tplName = EVENT_TEMPLATE[type]
  const tpl     = await loadTemplate(tplName)
  if (!tpl) {
    logger.warn({ tplName, alertKey }, 'alert_template_not_found')
    return
  }

  // 3. Verifica limites anti-spam globais do ClienteFinal
  if (config) {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const dayAgo  = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const [sentHour, sentDay] = await Promise.all([
      prisma.alertDelivery.count({
        where: { clienteFinalId, status: 'SENT', sentAt: { gte: hourAgo } },
      }),
      prisma.alertDelivery.count({
        where: { clienteFinalId, status: 'SENT', sentAt: { gte: dayAgo } },
      }),
    ])
    if (sentHour >= config.maxEmailsPerHour) {
      logger.warn({ clienteFinalId, sentHour, max: config.maxEmailsPerHour }, 'alert_rate_limit_hour')
      await logDelivery({ alertKey, email: 'RATE_LIMITED', subject: '', status: 'SUPPRESSED_LIMIT', type, severity, clienteFinalId, cameraId: event.cameraId, payload })
      return
    }
    if (sentDay >= config.maxEmailsPerDay) {
      logger.warn({ clienteFinalId, sentDay, max: config.maxEmailsPerDay }, 'alert_rate_limit_day')
      await logDelivery({ alertKey, email: 'RATE_LIMITED', subject: '', status: 'SUPPRESSED_LIMIT', type, severity, clienteFinalId, cameraId: event.cameraId, payload })
      return
    }
  }

  // 4. Busca destinatários do ClienteFinal ativos
  const recipients = await prisma.alertRecipient.findMany({
    where: {
      clienteFinalId,
      active: true,
      ...(severity === 'CRITICAL' ? { rcvCritical: true } :
          severity === 'WARNING'  ? { rcvWarning:  true } :
                                    { rcvInfo:     true }),
      ...(type === 'CAMERA_DOWN'  ? { rcvCameraDown:  true } :
          type === 'CAMERA_UP'    ? { rcvCameraUp:    true } :
          type === 'TRIGGER_FIRE' ? { rcvTriggerFire: true } :
          type === 'DIGEST'       ? { rcvDigest:      true } : {}),
    },
    include: { clienteFinal: { select: { timezone: true, integradorId: true } } },
  })

  if (recipients.length === 0) {
    logger.debug({ clienteFinalId, type, severity }, 'alert_no_recipients')
    return
  }

  // 5. Para cada destinatário: verifica cooldown, quiet window, envia
  const escaladeEmails = new Set<string>()

  for (const recipient of recipients) {
    const tz = recipient.clienteFinal?.timezone ?? 'America/Sao_Paulo'

    // Quiet window
    if (isInQuietWindow(recipient.quietStart, recipient.quietEnd, tz)) {
      await logDelivery({ alertKey, email: recipient.email, subject: '', status: 'SUPPRESSED_QUIET', type, severity, clienteFinalId, cameraId: event.cameraId, payload })
      continue
    }

    // Cooldown
    if (cooldownSec > 0) {
      const suppressed = await prisma.alertDelivery.findFirst({
        where: {
          alertKey,
          recipientEmail: recipient.email,
          suppressUntil:  { gt: new Date() },
        },
        select: { id: true },
      })
      if (suppressed) {
        await logDelivery({ alertKey, email: recipient.email, subject: '', status: 'SUPPRESSED_COOLDOWN', type, severity, clienteFinalId, cameraId: event.cameraId, payload })
        continue
      }
    }

    // Renderiza
    const escaladeNote = recipient.escalateToIntegrador && severity === 'CRITICAL'
      ? 'ℹ️  O Integrador responsável foi copiado neste alerta.\n\n'
      : ''
    const vars    = { ...payload, escaladeNote }
    const subject = renderTemplate(tpl.subject, vars)
    const text    = renderTemplate(tpl.body,    vars)

    // Envia
    const result = await sendMail({ to: recipient.email, subject, text })
    const status = result.sent ? 'SENT' : 'FAILED'

    await logDelivery({
      alertKey, email: recipient.email, subject, status,
      errorMsg: result.reason, type, severity, clienteFinalId,
      cameraId: event.cameraId, payload,
      suppressUntil: result.sent && cooldownSec > 0
        ? new Date(Date.now() + cooldownSec * 1000) : undefined,
    })

    logger.info({ to: recipient.email, alertKey, status, type, severity }, 'alert_dispatched')

    // Coleta emails para escalada ao Integrador
    if (result.sent && recipient.escalateToIntegrador && severity === 'CRITICAL') {
      escaladeEmails.add(recipient.email)
    }
  }

  // 6. Escalada para Integrador — somente se pelo menos 1 destinatário do CF
  //    habilitou escalada E o alerta foi CRITICAL
  if (escaladeEmails.size > 0 || config?.integradorForceReceiveCritical) {
    const cf = await prisma.clienteFinal.findUnique({
      where: { id: clienteFinalId },
      select: { integradorId: true, name: true },
    })
    if (cf) {
      await dispatchToIntegrador({
        integradorId:   cf.integradorId,
        clienteName:    payload.clienteName ?? cf.name,
        event, tpl, cooldownSec, payload,
      })
    }
  }
}

// ── Escalada ao Integrador ────────────────────────────────────────────────────

async function dispatchToIntegrador(opts: {
  integradorId:  string
  clienteName:   string
  event:         AlertEvent
  tpl:           { subject: string; body: string }
  cooldownSec:   number
  payload:       Record<string, string>
}): Promise<void> {
  const { integradorId, event, tpl, cooldownSec } = opts

  const integradorRecipients = await prisma.alertRecipient.findMany({
    where: { integradorId, active: true, rcvCritical: true },
  })

  for (const recipient of integradorRecipients) {
    // Cooldown próprio do integrador (usa a mesma alertKey + email dele)
    if (cooldownSec > 0) {
      const suppressed = await prisma.alertDelivery.findFirst({
        where: {
          alertKey:       `integ:${event.alertKey}`,
          recipientEmail: recipient.email,
          suppressUntil:  { gt: new Date() },
        },
        select: { id: true },
      })
      if (suppressed) continue
    }

    const vars    = { ...opts.payload, escaladeNote: `⚡ Escalado por cliente: ${opts.clienteName}\n\n` }
    const subject = renderTemplate(tpl.subject, vars)
    const text    = renderTemplate(tpl.body,    vars)

    const result = await sendMail({ to: recipient.email, subject, text })

    await logDelivery({
      alertKey:  `integ:${event.alertKey}`,
      email:     recipient.email,
      subject,
      status:    result.sent ? 'SENT' : 'FAILED',
      errorMsg:  result.reason,
      type:      event.type,
      severity:  event.severity,
      clienteFinalId: event.clienteFinalId,
      integradorId,
      cameraId:  event.cameraId,
      payload:   opts.payload,
      suppressUntil: result.sent && cooldownSec > 0
        ? new Date(Date.now() + cooldownSec * 1000) : undefined,
    })

    logger.info({ to: recipient.email, alertKey: `integ:${event.alertKey}` }, 'alert_escalated_to_integrador')
  }
}

// ── Helper: gravar AlertDelivery ──────────────────────────────────────────────

async function logDelivery(opts: {
  alertKey:       string
  email:          string
  subject:        string
  status:         string
  errorMsg?:      string | null
  type:           AlertEventType
  severity:       AlertSeverity
  clienteFinalId: string
  integradorId?:  string
  cameraId?:      string
  payload:        Record<string, string>
  suppressUntil?: Date
}): Promise<void> {
  try {
    await prisma.alertDelivery.create({
      data: {
        alertKey:       opts.alertKey,
        recipientEmail: opts.email,
        subject:        opts.subject,
        status:         opts.status,
        errorMsg:       opts.errorMsg ?? null,
        eventType:      opts.type,
        severity:       opts.severity,
        clienteFinalId: opts.clienteFinalId,
        integradorId:   opts.integradorId ?? null,
        cameraId:       opts.cameraId ?? null,
        metadataJson:   opts.payload as any,
        suppressUntil:  opts.suppressUntil ?? null,
      },
    })
  } catch (err: any) {
    logger.warn({ err: err.message }, 'alert_delivery_log_failed')
  }
}

// ── Export ────────────────────────────────────────────────────────────────────

export const alertService = { dispatch }
