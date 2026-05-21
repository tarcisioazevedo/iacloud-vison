/**
 * semantic-rule.service.ts — cron que avalia SemanticRules via Gemini.
 *
 * Fluxo:
 *   1. Tick a cada SEMANTIC_TICK_MS (default 30s)
 *   2. Busca regras enabled com lastEvaluatedAt > intervalSec atrás
 *   3. Para cada, captura snapshot da camera, chama Gemini para decidir
 *      se o prompt "casa" com a cena
 *   4. Se sim: incrementa fireCount, atualiza lastFiredAt, cria
 *      DetectionEvent + dispara alerta multi-canal
 *
 * Reusa:
 *  - genai.describeLiveScene (descreve cena) OU chamada estruturada
 *  - ffmpeg-snapshot.captureSnapshot (gera JPEG do live)
 *  - notification-dispatcher.dispatchAlert (multi-canal)
 *  - Camera.rtspMainUrl como fonte do snapshot
 *
 * Custo: 1 Gemini Flash call por regra × intervalSec. Com 38 regras a 30s:
 *   38 × (3600/30) × 24 = 109k calls/dia (~R$ 13/dia, em escala).
 */
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { captureSnapshot, FfmpegSnapshotError } from './ffmpeg-snapshot.service'
import { evaluateSemanticRule } from './genai.service'
import { dispatchAlert } from '../lib/notification-dispatcher'

const TICK_MS = Number(process.env.SEMANTIC_TICK_MS ?? 30_000)
const MAX_PER_TICK = Number(process.env.SEMANTIC_MAX_PER_TICK ?? 10)

let timer: NodeJS.Timeout | null = null
let running = false

/**
 * Avalia uma regra contra um snapshot atual da câmera.
 * Retorna true se a regra "casou" (deve disparar).
 */
async function evaluateOne(rule: {
  id: string
  cameraId: string
  prompt: string
  severity: string
  notifyChannels: string[]
  intervalSec: number
  fireCount: number
}): Promise<void> {
  const camera = await prisma.camera.findUnique({
    where: { id: rule.cameraId },
    select: {
      id: true, name: true, active: true, aiEnabled: true,
      rtspMainUrl: true,
      site: { select: { clienteFinal: { select: { id: true, integradorId: true } } } },
    },
  })
  if (!camera || !camera.active || !camera.aiEnabled || !camera.rtspMainUrl) {
    await prisma.semanticRule.update({
      where: { id: rule.id },
      data: { lastEvaluatedAt: new Date() },
    }).catch(() => {})
    return
  }

  // Captura snapshot
  let jpeg: Buffer
  try {
    jpeg = await captureSnapshot(camera.rtspMainUrl)
  } catch (err: any) {
    if (err instanceof FfmpegSnapshotError) {
      logger.warn({ ruleId: rule.id, code: err.code }, 'semantic_rule_snapshot_failed')
    }
    await prisma.semanticRule.update({
      where: { id: rule.id },
      data: { lastEvaluatedAt: new Date() },
    }).catch(() => {})
    return
  }

  // Pergunta ao Gemini se a regra casa
  const evalResult = await evaluateSemanticRule(jpeg, rule.prompt)
  await prisma.semanticRule.update({
    where: { id: rule.id },
    data: { lastEvaluatedAt: new Date() },
  }).catch(() => {})

  if (!evalResult || !evalResult.matches) return

  // Dispara
  await prisma.semanticRule.update({
    where: { id: rule.id },
    data: {
      lastFiredAt: new Date(),
      fireCount:   { increment: 1 },
    },
  }).catch(() => {})

  logger.info({
    ruleId: rule.id, cameraId: rule.cameraId, fireCount: rule.fireCount + 1,
  }, 'semantic_rule_fired')

  if (camera.site?.clienteFinal) {
    const severity = (rule.severity.toUpperCase() as 'INFO' | 'WARNING' | 'CRITICAL') || 'WARNING'
    dispatchAlert({
      integradorId:   camera.site.clienteFinal.integradorId,
      clienteFinalId: camera.site.clienteFinal.id,
      title:          `🎯 Alerta semântico — ${camera.name}`,
      body:           `${evalResult.reason ?? rule.prompt}`,
      cameraName:     camera.name,
      severity,
    }).catch(err => logger.warn({ err: err.message }, 'semantic_rule_dispatch_failed'))
  }
}

async function tick(): Promise<void> {
  if (running) return
  running = true
  try {
    const now = new Date()
    // Busca regras enabled cujo lastEvaluatedAt + intervalSec já venceu
    const rules = await prisma.semanticRule.findMany({
      where: {
        enabled: true,
        OR: [
          { lastEvaluatedAt: null },
          // lastEvaluatedAt + intervalSec <= now (em SQL bruto seria complicado;
          // filtramos depois em memória pelo intervalSec)
        ],
      },
      orderBy: { lastEvaluatedAt: { sort: 'asc', nulls: 'first' } },
      take: MAX_PER_TICK * 3, // pega mais e filtra em memória
    })

    const due = rules.filter(r => {
      if (!r.lastEvaluatedAt) return true
      const ageSec = (now.getTime() - r.lastEvaluatedAt.getTime()) / 1000
      return ageSec >= r.intervalSec
    }).slice(0, MAX_PER_TICK)

    if (due.length === 0) return

    // Processa em paralelo (Gemini Flash é stateless)
    await Promise.all(due.map(r => evaluateOne(r).catch(err =>
      logger.warn({ err: err.message, ruleId: r.id }, 'semantic_rule_evaluate_failed')
    )))
  } finally {
    running = false
  }
}

export const semanticRuleService = {
  start(): void {
    if (timer) return
    timer = setInterval(() => {
      tick().catch(err => logger.warn({ err: err.message }, 'semantic_rule_tick_failed'))
    }, TICK_MS)
    logger.info({ tickMs: TICK_MS, maxPerTick: MAX_PER_TICK }, 'semantic_rule_service_started')
    // Não roda no boot — evita rush de Gemini calls
  },

  stop(): void {
    if (timer) { clearInterval(timer); timer = null }
  },
}
