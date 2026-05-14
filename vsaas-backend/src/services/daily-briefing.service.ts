/**
 * DailyBriefingJob — gera resumo diário automático com Gemini Pro.
 *
 * Roda 1x por dia (07:00 BRT default) e cria 1 DetectionDailyBriefing por
 * integrador ativo cobrindo as últimas 24h.
 *
 * Pipeline:
 *  1. Lista integradores com >= 1 câmera com aiEnabled=true
 *  2. Para cada um, agrega stats das últimas 24h:
 *     • count(ReviewSegment) por severity
 *     • count(DetectionEvent) por objectType
 *     • count(camera) com atividade
 *     • highlights: eventos com alta confiança ou descrição interessante
 *  3. Monta prompt em PT-BR
 *  4. Gemini Pro gera summary (5-10 frases factual)
 *  5. Persiste em DetectionDailyBriefing (unique [integradorId, date])
 *
 * Custo: ~R$0,05 por briefing/integrador/dia.
 */

import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { summarizePeriod, genaiAvailable } from './genai.service'

const HOUR_BRT = Number(process.env.BRIEFING_HOUR_BRT ?? 7)
// BRT = UTC-3. Hora UTC equivalente:
const HOUR_UTC = (HOUR_BRT + 3) % 24

let timer: NodeJS.Timeout | null = null
let lastRunDate: string | null = null

function isoDateUtc(d: Date): string {
  return d.toISOString().slice(0, 10)
}

async function buildBriefingForIntegrador(integradorId: string, date: Date): Promise<void> {
  const dateKey = isoDateUtc(date)
  const from = new Date(date.getTime() - 24 * 60 * 60 * 1000)
  const to = date

  // Stats agregados (1 query cada — não pesa)
  const [alertCount, detCount, eventsByType, camerasActive, topEvents] = await Promise.all([
    prisma.reviewSegment.count({
      where: {
        camera: { site: { clienteFinal: { integradorId } } },
        startTime: { gte: from, lte: to },
        severity: 'ALERT',
      },
    }),
    prisma.reviewSegment.count({
      where: {
        camera: { site: { clienteFinal: { integradorId } } },
        startTime: { gte: from, lte: to },
        severity: 'DETECTION',
      },
    }),
    prisma.detectionEvent.groupBy({
      by: ['objectType'],
      where: {
        camera: { site: { clienteFinal: { integradorId } } },
        startTime: { gte: from, lte: to },
        falsePositive: false,
      },
      _count: true,
    }),
    prisma.camera.count({
      where: {
        aiEnabled: true,
        active: true,
        site: { clienteFinal: { integradorId } },
        detectionEvents: { some: { startTime: { gte: from, lte: to } } },
      },
    }),
    prisma.detectionEvent.findMany({
      where: {
        camera: { site: { clienteFinal: { integradorId } } },
        startTime: { gte: from, lte: to },
        falsePositive: false,
        description: { not: null },
      },
      orderBy: [{ topScore: 'desc' }],
      take: 5,
      select: {
        objectType: true, startTime: true, topScore: true,
        description: true,
        camera: { select: { name: true } },
      },
    }),
  ])

  const totalEvents = eventsByType.reduce((a, b) => a + b._count, 0)
  if (totalEvents === 0 && alertCount === 0) {
    // Não vale gastar Gemini se não houve nada. Cria briefing vazio standardizado.
    await prisma.detectionDailyBriefing.upsert({
      where: { integradorId_date: { integradorId, date } },
      create: {
        integradorId, date,
        summary: 'Sem detecções IA registradas no período. Câmeras com AI ativado: 0 com atividade.',
        highlights: { alertCount: 0, detCount: 0, totalEvents: 0, camerasActive: 0 } as any,
        cost: 0,
      },
      update: {},
    })
    return
  }

  const prompt = `
Resuma a atividade de vigilância CFTV das últimas 24h em PT-BR, 5-8 frases.
Foco em fatos numéricos e padrões observáveis. NÃO especule.

DADOS:
• Alertas (alta prioridade): ${alertCount}
• Detecções (baixa prioridade): ${detCount}
• Total de events: ${totalEvents}
• Câmeras com atividade: ${camerasActive}
• Distribuição por tipo:
${eventsByType.map(e => `  - ${e.objectType}: ${e._count}`).join('\n')}

EVENTOS DESTAQUE (alta confiança):
${topEvents.map((e, i) =>
  `${i + 1}. [${e.startTime.toISOString()}] ${e.camera.name} — ${e.objectType} (${Math.round(e.topScore * 100)}%): ${e.description}`,
).join('\n')}

INSTRUÇÕES:
- Comece com "🌙 Últimas 24h:" ou "📊 Resumo da atividade:"
- Mencione cameraS ativas, principal tipo detectado, picos de horário se evidentes
- Se houver alertas, destaque-os
- Termine com 1 sugestão acionável se aplicável (ex: "Verificar câmera X")
- Não invente nada — só use os dados fornecidos.
`.trim()

  const summary = await summarizePeriod(prompt)
  if (!summary) {
    logger.warn({ integradorId, dateKey }, 'briefing_gemini_failed')
    return
  }

  await prisma.detectionDailyBriefing.upsert({
    where: { integradorId_date: { integradorId, date } },
    create: {
      integradorId, date,
      summary,
      highlights: {
        alertCount,
        detCount,
        totalEvents,
        camerasActive,
        byType: eventsByType.map(e => ({ type: e.objectType, count: e._count })),
        topEvents: topEvents.map(e => ({
          objectType: e.objectType,
          camera: e.camera.name,
          confidence: Math.round(e.topScore * 100),
          startTime: e.startTime.toISOString(),
        })),
      } as any,
      cost: 0.05,  // estimativa Gemini Pro
    },
    update: {
      summary,
      generatedAt: new Date(),
    },
  })

  logger.info({
    integradorId, dateKey,
    alertCount, totalEvents, camerasActive,
  }, 'briefing_generated')
}

async function runIfDue(): Promise<void> {
  const now = new Date()
  const dateKey = isoDateUtc(now)

  // Só roda 1x por dia (após HOUR_UTC)
  if (lastRunDate === dateKey) return
  if (now.getUTCHours() < HOUR_UTC) return

  if (!genaiAvailable()) return

  lastRunDate = dateKey

  // Lista integradores ativos com IA habilitada em pelo menos 1 câmera
  const integradores = await prisma.integrador.findMany({
    where: {
      active: true,
      clientesFinais: {
        some: { sites: { some: { cameras: { some: { aiEnabled: true, active: true } } } } },
      },
    },
    select: { id: true, name: true },
  })

  logger.info({ count: integradores.length, dateKey }, 'briefing_run_start')

  for (const i of integradores) {
    try {
      await buildBriefingForIntegrador(i.id, now)
    } catch (e: any) {
      logger.warn({ integradorId: i.id, err: e.message }, 'briefing_integrador_failed')
    }
  }
}

export const dailyBriefingJob = {
  start(): void {
    if (timer) return
    if (!genaiAvailable()) {
      logger.warn('daily_briefing_disabled — no Gemini credentials')
      return
    }
    // Check every 30 min — leve, e captura a janela mesmo se o backend reiniciar
    timer = setInterval(() => {
      runIfDue().catch(err => logger.warn({ err: err.message }, 'briefing_check_failed'))
    }, 30 * 60 * 1000)
    logger.info({ hourBrt: HOUR_BRT, hourUtc: HOUR_UTC }, 'daily_briefing_job_started')
  },
  stop(): void {
    if (timer) { clearInterval(timer); timer = null }
  },
}
