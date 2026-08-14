/**
 * asaas-billing-overview — montador único do estado do billing.
 *
 * Substitui 4 endpoints separados que o frontend antes consultava em paralelo.
 * Reduz round-trips de ~400ms para ~120ms.
 *
 * Cobre:
 *   - config:           credenciais (sem expor valores), env, conta Asaas
 *   - counts:           customers, subscriptions, webhooks 24h, FAILED, PENDING
 *   - webhookHealth:    se a fila Asaas está penalizada/interrompida (do health monitor)
 *   - recentEvents:     últimos 10 AsaasWebhookEvent (ID + status + erro)
 *   - customers:        top 20
 *   - subscriptions:    ativas (top 50)
 *
 * Cache em memória 5s pra evitar pressão no DB quando UI faz polling 30s.
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { getAsaasConfig } from './asaas-config.service'
import { isBillingEnabled } from './asaas.service'
import axios from 'axios'

interface OverviewConfig {
  enabled:          boolean
  configured:       boolean
  source:           'db' | 'env'
  environment:      'PROD' | 'SANDBOX'
  apiKeyPreview:    string | null
  webhookSecretSet: boolean
  accountName:      string | null
  accountEmail:     string | null
  lastValidatedAt:  Date | null
  lastValidatedOk:  boolean
  lastError:        string | null
}

interface OverviewCounts {
  customers:           number
  activeSubscriptions: number
  recentWebhooks24h:   number
  failedWebhooks:      number
  pendingWebhooks:     number
}

interface WebhookHealth {
  monitored:               boolean
  webhookId:               string | null
  webhookEnabled:          boolean
  interrupted:             boolean
  penalizedRequestsCount:  number
}

interface RecentEvent {
  id:           string
  eventId:      string
  eventName:    string
  status:       string
  receivedAt:   Date
  processedAt:  Date | null
  errorMessage: string | null
}

export interface Overview {
  config:        OverviewConfig
  counts:        OverviewCounts
  webhookHealth: WebhookHealth
  recentEvents:  RecentEvent[]
  customers:     Array<{ id: string; asaasCustomerId: string; email: string | null; cpfCnpj: string | null; integrador: { id: string; name: string; tradeName: string | null } | null }>
  subscriptions: Array<{ id: string; asaasSubscriptionId: string; planSlug: string; value: number; cycle: string; status: string; nextDueDate: Date; billingType: string | null; integrador: { id: string; name: string; tradeName: string | null } | null }>
  notes:         string | null
}

let _cache: { data: Overview; fetchedAt: number } | null = null
const CACHE_TTL_MS = 5_000

export function invalidateOverviewCache(): void {
  _cache = null
}

async function fetchWebhookHealth(cfg: Awaited<ReturnType<typeof getAsaasConfig>>): Promise<WebhookHealth> {
  if (!cfg.apiKey) {
    return { monitored: false, webhookId: null, webhookEnabled: false, interrupted: false, penalizedRequestsCount: 0 }
  }
  const baseURL = cfg.environment === 'SANDBOX'
    ? 'https://api-sandbox.asaas.com/v3'
    : 'https://api.asaas.com/v3'
  try {
    const r = await axios.get<{ data: Array<{ id: string; enabled: boolean; interrupted: boolean; penalizedRequestsCount: number }> }>(
      `${baseURL}/webhooks`,
      {
        headers: { access_token: cfg.apiKey, 'User-Agent': 'IACloudVision/1.0-overview' },
        timeout: 5_000,
      },
    )
    const first = r.data?.data?.[0]
    if (!first) {
      return { monitored: true, webhookId: null, webhookEnabled: false, interrupted: false, penalizedRequestsCount: 0 }
    }
    return {
      monitored:               true,
      webhookId:               first.id,
      webhookEnabled:          first.enabled,
      interrupted:             first.interrupted,
      penalizedRequestsCount:  first.penalizedRequestsCount ?? 0,
    }
  } catch (err) {
    logger.warn({ err }, 'asaas_overview_webhook_health_failed')
    return { monitored: false, webhookId: null, webhookEnabled: false, interrupted: false, penalizedRequestsCount: 0 }
  }
}

export async function getBillingOverview(opts: { forceReload?: boolean } = {}): Promise<Overview> {
  if (!opts.forceReload && _cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) {
    return _cache.data
  }

  const cfg = await getAsaasConfig({ forceReload: opts.forceReload })
  const since24h = new Date(Date.now() - 24 * 3600_000)

  // Run em paralelo: counts + recent events + customers + subscriptions + asaas webhook health
  const [
    customers,
    activeSubscriptions,
    recentWebhooks24h,
    failedWebhooks,
    pendingWebhooks,
    recentEvents,
    customersList,
    subscriptionsList,
    webhookHealth,
  ] = await Promise.all([
    prisma.asaasCustomer.count(),
    prisma.asaasSubscription.count({ where: { status: 'ACTIVE' } }),
    prisma.asaasWebhookEvent.count({ where: { receivedAt: { gte: since24h } } }),
    prisma.asaasWebhookEvent.count({ where: { status: 'FAILED' } }),
    prisma.asaasWebhookEvent.count({ where: { status: 'PENDING' } }),
    prisma.asaasWebhookEvent.findMany({
      orderBy: { receivedAt: 'desc' },
      take: 10,
      select: { id: true, eventId: true, eventName: true, status: true, receivedAt: true, processedAt: true, errorMessage: true },
    }),
    prisma.asaasCustomer.findMany({
      orderBy: { syncedAt: 'desc' },
      take: 20,
      include: {
        integrador: { select: { id: true, name: true, tradeName: true } },
      },
    }),
    prisma.asaasSubscription.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        integrador: { select: { id: true, name: true, tradeName: true } },
      },
    }),
    fetchWebhookHealth(cfg),
  ])

  const enabled = isBillingEnabled()

  let notes: string | null = null
  if (!enabled) {
    notes = 'BILLING_ENABLED=false ou ASAAS_API_KEY ausente — use o card "Rotacionar API key" abaixo pra ativar.'
  } else if (webhookHealth.interrupted) {
    notes = `⚠ Fila do webhook PAUSADA — ${webhookHealth.penalizedRequestsCount} falhas consecutivas. Use o botão "Reativar fila" abaixo.`
  } else if (failedWebhooks > 0) {
    notes = `${failedWebhooks} webhook(s) com status FAILED — clique em "Reprocessar" na tabela abaixo.`
  }

  const overview: Overview = {
    config: {
      enabled,
      configured:       !!cfg.apiKey,
      source:           cfg.source,
      environment:      cfg.environment,
      apiKeyPreview:    cfg.apiKey ? cfg.apiKey.slice(0, 12) + '…' : null,
      webhookSecretSet: !!cfg.webhookSecret,
      accountName:      cfg.accountName,
      accountEmail:     cfg.accountEmail,
      lastValidatedAt:  cfg.lastValidatedAt,
      lastValidatedOk:  cfg.lastValidatedOk,
      lastError:        cfg.lastError,
    },
    counts: {
      customers,
      activeSubscriptions,
      recentWebhooks24h,
      failedWebhooks,
      pendingWebhooks,
    },
    webhookHealth,
    recentEvents: recentEvents.map(e => ({
      id:           e.id,
      eventId:      e.eventId,
      eventName:    e.eventName,
      status:       e.status,
      receivedAt:   e.receivedAt,
      processedAt:  e.processedAt,
      errorMessage: e.errorMessage,
    })),
    customers: customersList.map(c => ({
      id:              c.id,
      asaasCustomerId: c.asaasCustomerId,
      email:           c.email,
      cpfCnpj:         c.cpfCnpj,
      integrador:      c.integrador,
    })),
    subscriptions: subscriptionsList.map(s => ({
      id:                  s.id,
      asaasSubscriptionId: s.asaasSubscriptionId,
      planSlug:            s.planSlug,
      value:               Number(s.value),
      cycle:               s.cycle,
      status:              s.status,
      nextDueDate:         s.nextDueDate,
      billingType:         s.billingType,
      integrador:          s.integrador,
    })),
    notes,
  }

  _cache = { data: overview, fetchedAt: Date.now() }
  return overview
}
