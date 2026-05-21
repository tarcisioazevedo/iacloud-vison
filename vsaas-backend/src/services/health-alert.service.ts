/**
 * Health Alert service — alerta proativo quando cliente entra em estado
 * crítico/ruim e fica assim por > 24h.
 *
 * Idempotência: 1 alerta por (clienteFinalId, dia) — usa createdAt como
 * filtro pra evitar disparar 4× ao dia.
 *
 * Resolution: alerta tem `resolvedAt` setado automaticamente quando o
 * health score volta pra warn/good/optimal.
 *
 * Sugestões automáticas: baseadas no signal pior — texto pt-BR direto pra
 * integrador agir (ex: "Verificar conectividade da rede do site X").
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { computeHealthScoresBulk, type HealthScoreSignal } from './health-score.service'

const ALERT_TIERS = new Set(['critical', 'bad'])
const RESOLUTION_TIERS = new Set(['warn', 'good', 'optimal'])

interface ProcessResult {
  total: number
  alertsCreated: number
  alertsResolved: number
  byLevel: Record<string, number>
}

/**
 * Gera sugestão de ação em pt-BR baseada nos signals piores.
 */
function suggestionFor(signals: HealthScoreSignal[]): string {
  const worst = [...signals].sort((a, b) => a.value - b.value)[0]
  if (!worst) return 'Verificar saúde geral do cliente.'

  switch (worst.key) {
    case 'cameras':
      return 'Câmeras inativas — verificar conectividade da rede do site, status RTSP/ONVIF e energia das câmeras.'
    case 'edge':
      return 'Edge boxes offline — verificar link do site, energia e status do serviço iacv-bridge no box.'
    case 'activity_24h':
      return 'Sem eventos nas últimas 24h — confirmar se as câmeras estão capturando, modelos de IA estão habilitados e gatilhos estão ativos.'
    case 'freshness':
      return 'Sistema mudo há muito tempo — possível desconexão de todos os boxes/câmeras. Verificar VPN/firewall do site.'
    case 'quota':
      return 'Quota Vertex AI próxima do limite — considerar upgrade de plano ou redução de fps de processamento.'
    default:
      return `Sinal "${worst.key}" em estado crítico (${worst.value}/100). Investigar.`
  }
}

/**
 * Processa todos os alertas: cria novos, marca como resolvidos os que voltaram.
 */
export async function processHealthAlerts(): Promise<ProcessResult> {
  const scores = await computeHealthScoresBulk()
  const result: ProcessResult = {
    total: scores.length, alertsCreated: 0, alertsResolved: 0,
    byLevel: { critical: 0, bad: 0 },
  }

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

  for (const s of scores) {
    if (ALERT_TIERS.has(s.tier)) {
      // Verificar cooldown — se já houve alerta nas últimas 24h, pula
      const recentAlert = await prisma.healthAlert.findFirst({
        where: {
          clienteFinalId: s.clienteFinalId,
          sentAt: { gte: oneDayAgo },
        },
        orderBy: { sentAt: 'desc' },
      })
      if (recentAlert) continue

      // Pega só os signals piores (status='crit') pra payload
      const worstSignals = s.signals
        .filter(sig => sig.status === 'crit')
        .map(sig => ({ key: sig.key, value: sig.value, message: sig.message }))

      const alert = await prisma.healthAlert.create({
        data: {
          clienteFinalId: s.clienteFinalId,
          integradorId: s.integradorId,
          level: s.tier,  // 'critical' | 'bad'
          score: s.score,
          signalsJson: worstSignals,
          suggestion: suggestionFor(s.signals),
          channelsSent: { panel: true, webhook: false, email: false },
        },
      })

      // Audit
      try {
        await prisma.auditLog.create({
          data: {
            integradorId: s.integradorId,
            action: 'HEALTH_ALERT_CREATED',
            resource: 'HealthAlert',
            resourceId: alert.id,
            metadataJson: { level: s.tier, score: s.score, clienteFinalId: s.clienteFinalId },
          },
        })
      } catch (err) {
        logger.warn({ err }, 'health_alert_audit_failed')
      }

      result.alertsCreated++
      result.byLevel[s.tier] = (result.byLevel[s.tier] ?? 0) + 1
      logger.info({ clienteFinalId: s.clienteFinalId, level: s.tier, score: s.score }, 'health_alert_created')
    } else if (RESOLUTION_TIERS.has(s.tier)) {
      // Score voltou — marcar alertas pendentes como resolved
      const updated = await prisma.healthAlert.updateMany({
        where: {
          clienteFinalId: s.clienteFinalId,
          resolvedAt: null,
        },
        data: { resolvedAt: new Date() },
      })
      if (updated.count > 0) {
        result.alertsResolved += updated.count
        logger.info({ clienteFinalId: s.clienteFinalId, resolved: updated.count, score: s.score }, 'health_alerts_resolved')
      }
    }
  }

  return result
}

/**
 * Reconhece um alerta — integrador clica "marcar como visto".
 */
export async function acknowledgeAlert(alertId: string, userId: string) {
  return prisma.healthAlert.update({
    where: { id: alertId },
    data: { acknowledgedAt: new Date(), acknowledgedBy: userId },
  })
}

/**
 * Lista alertas ativos (não resolvidos e não reconhecidos) de um integrador.
 * Pra o painel "Ações Necessárias" no cockpit.
 *
 * IMPORTANTE: filtra também por `acknowledgedAt: null` — quando o integrador
 * clica "✓ marcar como visto" no card, o alerta sai da lista ativa imediatamente.
 * Se o problema subjacente persistir, o cron cria um novo alerta após 24h
 * (cooldown em processHealthAlerts).
 */
export async function listActiveAlerts(integradorId: string) {
  return prisma.healthAlert.findMany({
    where: { integradorId, resolvedAt: null, acknowledgedAt: null },
    include: {
      clienteFinal: { select: { id: true, name: true, vertical: true, city: true } },
    },
    orderBy: [
      { level: 'asc' },     // 'bad' < 'critical' alfabeticamente; mas a UI ordena por score
      { sentAt: 'desc' },
    ],
  })
}

/**
 * Lista todos os alertas (pra fabricante / admin) — com filtros opcionais.
 */
export async function listAllAlerts(opts?: {
  integradorId?: string
  level?: string
  unresolved?: boolean
  limit?: number
}) {
  const limit = Math.min(opts?.limit ?? 100, 500)
  return prisma.healthAlert.findMany({
    where: {
      ...(opts?.integradorId && { integradorId: opts.integradorId }),
      ...(opts?.level && { level: opts.level }),
      ...(opts?.unresolved && { resolvedAt: null }),
    },
    include: {
      clienteFinal: { select: { id: true, name: true, vertical: true } },
    },
    orderBy: { sentAt: 'desc' },
    take: limit,
  })
}
