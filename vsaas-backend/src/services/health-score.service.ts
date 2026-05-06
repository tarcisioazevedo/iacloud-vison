/**
 * Health Score por ClienteFinal — score 0-100 com semáforo verde/amarelo/vermelho.
 *
 * Sinais agregados (peso entre parênteses):
 *   - Câmeras ativas / total (30%)         — uptime operacional
 *   - Edge boxes ONLINE / total (25%)      — saúde da infraestrutura
 *   - Atividade nas últimas 24h (20%)      — sistema em uso
 *   - Quota usage (15%)                    — alarme se ≥ 90% (over) ou ≤ 5% por 7d (under)
 *   - Tempo desde última atividade (10%)   — boxes mudas há > 24h derruba score
 *
 * Tiers (alinhado com HealthScoreBadge no frontend):
 *   95-100  Ótimo (verde brilhante)
 *   80-94   Bom (verde)
 *   60-79   Atenção (amarelo)
 *   40-59   Ruim (laranja)
 *    0-39   Crítico (vermelho)
 *
 * Cálculo é on-demand (sem worker). Cache leve em memória (60s) por clienteId
 * pra evitar hammering do dashboard. Sinais são puxados em paralelo pra latência baixa.
 */
import { prisma } from '../lib/prisma'

export interface HealthScoreSignal {
  key: string
  weight: number
  value: number          // 0-100
  status: 'ok' | 'warn' | 'crit'
  message: string
}

export interface ClienteFinalHealthScore {
  clienteFinalId: string
  clienteFinalName: string
  integradorId: string
  score: number          // 0-100, weighted avg dos signals
  tier: 'optimal' | 'good' | 'warn' | 'bad' | 'critical'
  signals: HealthScoreSignal[]
  computedAt: string
}

const cache = new Map<string, { ts: number; data: ClienteFinalHealthScore }>()
const CACHE_TTL_MS = 60_000

function tierFor(score: number): ClienteFinalHealthScore['tier'] {
  if (score >= 95) return 'optimal'
  if (score >= 80) return 'good'
  if (score >= 60) return 'warn'
  if (score >= 40) return 'bad'
  return 'critical'
}

function statusFromValue(value: number): 'ok' | 'warn' | 'crit' {
  if (value >= 80) return 'ok'
  if (value >= 50) return 'warn'
  return 'crit'
}

/**
 * Calcula health score de UM cliente final.
 * Idempotente, com cache de 60s.
 */
export async function computeHealthScore(clienteFinalId: string): Promise<ClienteFinalHealthScore | null> {
  const cached = cache.get(clienteFinalId)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data

  const cliente = await prisma.clienteFinal.findUnique({
    where: { id: clienteFinalId },
    select: { id: true, name: true, integradorId: true, active: true },
  })
  if (!cliente) return null

  // Sinais em paralelo
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const [
    cameraCounts, edgeCounts, recentEvents, lastEvent,
  ] = await Promise.all([
    // Câmeras: total vs ACTIVE
    prisma.camera.groupBy({
      by: ['status'],
      where: { site: { clienteFinalId } },
      _count: true,
    }),
    // Edge nodes: total vs ONLINE
    prisma.edgeNode.groupBy({
      by: ['status'],
      where: { site: { clienteFinalId } },
      _count: true,
    }),
    // Eventos nas últimas 24h
    prisma.analyticsEvent.count({
      where: {
        camera: { site: { clienteFinalId } },
        capturedAt: { gte: since24h },
      },
    }),
    // Último evento
    prisma.analyticsEvent.findFirst({
      where: { camera: { site: { clienteFinalId } } },
      orderBy: { capturedAt: 'desc' },
      select: { capturedAt: true },
    }),
  ])

  const camTotal = cameraCounts.reduce((s, c) => s + c._count, 0)
  const camActive = cameraCounts.find(c => c.status === 'ACTIVE')?._count ?? 0
  const camPct = camTotal === 0 ? 100 : (camActive / camTotal) * 100

  const edgeTotal = edgeCounts.reduce((s, c) => s + c._count, 0)
  const edgeOnline = edgeCounts.find(c => c.status === 'ONLINE')?._count ?? 0
  const edgePct = edgeTotal === 0 ? 100 : (edgeOnline / edgeTotal) * 100

  const activityScore = recentEvents > 100 ? 100 : recentEvents > 20 ? 85 : recentEvents > 0 ? 60 : 20

  const lastEventMs = lastEvent?.capturedAt ? Date.now() - lastEvent.capturedAt.getTime() : Infinity
  const lastEventHours = lastEventMs / (1000 * 60 * 60)
  const freshScore =
    lastEventHours < 1 ? 100 :
    lastEventHours < 6 ? 90 :
    lastEventHours < 24 ? 70 :
    lastEventHours < 72 ? 40 :
    10

  // Quota — placeholder (15%) — TODO: ler ApiUsageLog real do mês
  const quotaScore = 75

  const signals: HealthScoreSignal[] = [
    {
      key: 'cameras',
      weight: 30,
      value: Math.round(camPct),
      status: statusFromValue(camPct),
      message: camTotal === 0
        ? 'Nenhuma câmera cadastrada'
        : `${camActive}/${camTotal} câmeras ativas (${Math.round(camPct)}%)`,
    },
    {
      key: 'edge',
      weight: 25,
      value: Math.round(edgePct),
      status: statusFromValue(edgePct),
      message: edgeTotal === 0
        ? 'Nenhum edge box provisionado'
        : `${edgeOnline}/${edgeTotal} edges online (${Math.round(edgePct)}%)`,
    },
    {
      key: 'activity_24h',
      weight: 20,
      value: activityScore,
      status: statusFromValue(activityScore),
      message: recentEvents === 0
        ? 'Nenhum evento nas últimas 24h'
        : `${recentEvents} eventos nas últimas 24h`,
    },
    {
      key: 'quota',
      weight: 15,
      value: quotaScore,
      status: statusFromValue(quotaScore),
      message: 'Quota dentro da faixa esperada (placeholder — TODO)',
    },
    {
      key: 'freshness',
      weight: 10,
      value: freshScore,
      status: statusFromValue(freshScore),
      message: lastEvent
        ? `Último evento há ${
            lastEventHours < 1 ? '< 1h'
              : lastEventHours < 24 ? `${Math.round(lastEventHours)}h`
              : `${Math.round(lastEventHours / 24)}d`
          }`
        : 'Sem registros de eventos',
    },
  ]

  // Score final = média ponderada
  const totalWeight = signals.reduce((s, x) => s + x.weight, 0)
  const score = Math.round(
    signals.reduce((s, x) => s + x.value * x.weight, 0) / totalWeight,
  )

  // Cliente inativo derruba pra crítico
  const finalScore = cliente.active ? score : Math.min(score, 30)

  const result: ClienteFinalHealthScore = {
    clienteFinalId: cliente.id,
    clienteFinalName: cliente.name,
    integradorId: cliente.integradorId,
    score: finalScore,
    tier: tierFor(finalScore),
    signals,
    computedAt: new Date().toISOString(),
  }

  cache.set(clienteFinalId, { ts: Date.now(), data: result })
  return result
}

/**
 * Calcula health scores em lote.
 *   - integradorId definido → todos os clientes daquele integrador
 *   - integradorId null → todos os clientes (uso fabricante)
 */
export async function computeHealthScoresBulk(integradorId?: string): Promise<ClienteFinalHealthScore[]> {
  const clientes = await prisma.clienteFinal.findMany({
    where: integradorId ? { integradorId } : undefined,
    select: { id: true },
    orderBy: { name: 'asc' },
  })

  // Concorrência limitada a 8 pra não estourar pool do Prisma
  const concurrency = 8
  const results: ClienteFinalHealthScore[] = []
  for (let i = 0; i < clientes.length; i += concurrency) {
    const chunk = clientes.slice(i, i + concurrency)
    const scored = await Promise.all(chunk.map(c => computeHealthScore(c.id)))
    results.push(...scored.filter((x): x is ClienteFinalHealthScore => x !== null))
  }
  return results
}

/** Sumário agregado pra dashboard fabricante: contagem por tier */
export interface HealthScoreSummary {
  total: number
  byTier: Record<ClienteFinalHealthScore['tier'], number>
  averageScore: number
  worstClients: Array<{ id: string; name: string; score: number; tier: ClienteFinalHealthScore['tier'] }>
}

export function summarizeHealthScores(scores: ClienteFinalHealthScore[]): HealthScoreSummary {
  const byTier: HealthScoreSummary['byTier'] = {
    optimal: 0, good: 0, warn: 0, bad: 0, critical: 0,
  }
  for (const s of scores) byTier[s.tier]++

  const total = scores.length
  const avg = total === 0 ? 0 : Math.round(scores.reduce((s, x) => s + x.score, 0) / total)

  const worstClients = [...scores]
    .sort((a, b) => a.score - b.score)
    .slice(0, 5)
    .map(s => ({ id: s.clienteFinalId, name: s.clienteFinalName, score: s.score, tier: s.tier }))

  return { total, byTier, averageScore: avg, worstClients }
}
