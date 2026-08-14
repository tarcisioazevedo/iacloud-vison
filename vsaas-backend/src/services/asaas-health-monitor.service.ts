/**
 * asaas-health-monitor — cron 1h que verifica saúde da integração Asaas:
 *
 *   1. Lista webhooks via GET /webhooks
 *   2. Para cada webhook ativo, verifica:
 *      - `interrupted: true`        → fila pausada (após 15 falhas consecutivas)
 *      - `penalizedRequestsCount`   → quantas requisições já falharam
 *   3. Quando crítico, dispara:
 *      - logger.error (vai pro Sentry automaticamente)
 *      - email pro admin via FABRICANTE_ALERT_EMAIL
 *
 * Por que importante: depois de 15 webhooks falhados consecutivos, a fila do
 * Asaas pausa e eventos novos PARAM de chegar. Sem este monitor, descobrimos
 * só quando alguém reclamar que "pagamento não está atualizando o sistema".
 *
 * Custo: 1 GET /webhooks por hora (≈ 1 KB). Desprezível no rate limit.
 */
import axios from 'axios'
import { logger } from '../lib/logger'
import { sendMail } from '../lib/smtp'
import { isBillingEnabled } from './asaas.service'

const POLL_INTERVAL_MS = Number(process.env.ASAAS_HEALTH_MONITOR_INTERVAL_MS ?? 3600_000) // 1h

let _timer: ReturnType<typeof setInterval> | null = null

interface AsaasWebhookInfo {
  id:                       string
  name:                     string
  url:                      string
  enabled:                  boolean
  interrupted:              boolean
  penalizedRequestsCount:   number
  events:                   string[]
}

async function listWebhooks(): Promise<AsaasWebhookInfo[]> {
  const r = await axios.get<{ data: AsaasWebhookInfo[] }>(
    `${process.env.ASAAS_BASE_URL ?? 'https://api.asaas.com/v3'}/webhooks`,
    {
      headers: {
        access_token: process.env.ASAAS_API_KEY!,
        'User-Agent': 'IACloudVision/1.0-health-monitor',
      },
      timeout: 10_000,
    },
  )
  return r.data.data ?? []
}

async function alertAdmin(subject: string, html: string, text: string): Promise<void> {
  const email = process.env.FABRICANTE_ALERT_EMAIL ?? 'falecomtarcisio@gmail.com'
  await sendMail({ to: email, subject: `[Asaas health] ${subject}`, html, text })
    .catch(err => logger.warn({ err }, 'asaas_health_alert_email_failed'))
}

/**
 * Roda uma verificação completa. Retorna stats pra log.
 */
export async function checkAsaasHealth(): Promise<{
  webhooks:     number
  interrupted:  number
  penalized:    number
  alertsSent:   number
}> {
  if (!isBillingEnabled()) {
    return { webhooks: 0, interrupted: 0, penalized: 0, alertsSent: 0 }
  }

  let webhooks: AsaasWebhookInfo[]
  try {
    webhooks = await listWebhooks()
  } catch (err) {
    logger.error({ err }, 'asaas_health_monitor_list_failed')
    return { webhooks: 0, interrupted: 0, penalized: 0, alertsSent: 0 }
  }

  let interrupted = 0
  let penalized   = 0
  let alertsSent  = 0

  for (const wh of webhooks) {
    if (!wh.enabled) continue

    if (wh.interrupted) {
      interrupted++
      logger.error(
        { webhookId: wh.id, url: wh.url, penalizedRequestsCount: wh.penalizedRequestsCount },
        'asaas_webhook_queue_interrupted',
      )
      await alertAdmin(
        `Fila pausada — webhook ${wh.name}`,
        `<p><strong>A fila do webhook Asaas foi pausada</strong> após muitas falhas consecutivas.</p>
         <p>Webhook ID: <code>${wh.id}</code><br>
            URL: <code>${wh.url}</code><br>
            Falhas penalizadas: ${wh.penalizedRequestsCount}</p>
         <p>Eventos seguintes <strong>não chegarão</strong> até a fila ser reativada.
            Reativar em: Asaas painel → Integrações → Webhooks → ${wh.name} → "Remover penalização".</p>
         <p>Antes de reativar, investigar logs para encontrar a causa raiz.</p>`,
        `[CRÍTICO] Asaas pausou fila do webhook ${wh.id}. ${wh.penalizedRequestsCount} falhas. Reativar no painel após corrigir.`,
      )
      alertsSent++
    } else if (wh.penalizedRequestsCount > 0) {
      penalized++
      logger.warn(
        { webhookId: wh.id, url: wh.url, penalizedRequestsCount: wh.penalizedRequestsCount },
        'asaas_webhook_penalized',
      )
      // Não envia email a cada hora — só na primeira detecção (acumulado < 5)
      if (wh.penalizedRequestsCount <= 5) {
        await alertAdmin(
          `Falhas recentes — webhook ${wh.name}`,
          `<p>O webhook Asaas teve <strong>${wh.penalizedRequestsCount}</strong> falha(s) consecutiva(s).</p>
           <p>Webhook ID: <code>${wh.id}</code><br>URL: <code>${wh.url}</code></p>
           <p>Se chegar a <strong>15 falhas</strong>, a fila será pausada e eventos param de chegar.
              Investigar logs do backend antes que isso aconteça.</p>`,
          `Webhook ${wh.id} tem ${wh.penalizedRequestsCount} falhas. Investigar antes de chegar a 15.`,
        )
        alertsSent++
      }
    }
  }

  logger.info(
    { webhooks: webhooks.length, interrupted, penalized, alertsSent },
    'asaas_health_check_done',
  )
  return { webhooks: webhooks.length, interrupted, penalized, alertsSent }
}

export const asaasHealthMonitor = {
  /** Inicia o cron horário. Idempotente. */
  start(): void {
    if (_timer) return
    if (!isBillingEnabled()) {
      logger.info('asaas_health_monitor_skipped_billing_disabled')
      return
    }
    _timer = setInterval(() => {
      checkAsaasHealth().catch(err =>
        logger.error({ err }, 'asaas_health_monitor_tick_failed'),
      )
    }, POLL_INTERVAL_MS)
    // Roda 1x imediato na inicialização (10s delay pra DB/Asaas estarem prontos)
    setTimeout(() => {
      checkAsaasHealth().catch(err =>
        logger.error({ err }, 'asaas_health_monitor_initial_failed'),
      )
    }, 10_000)
    logger.info({ intervalMs: POLL_INTERVAL_MS }, 'asaas_health_monitor_started')
  },

  stop(): void {
    if (_timer) { clearInterval(_timer); _timer = null }
  },

  /** Trigger imediato (útil em /admin/billing/asaas/test-connection). */
  triggerNow(): Promise<{ webhooks: number; interrupted: number; penalized: number; alertsSent: number }> {
    return checkAsaasHealth()
  },
}
