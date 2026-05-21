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
import { aiGatingService } from './ai-gating.service'
import { rateLimitDedup } from './notification-dedup.service'

const TICK_MS = Number(process.env.SEMANTIC_TICK_MS ?? 30_000)
const MAX_PER_TICK = Number(process.env.SEMANTIC_MAX_PER_TICK ?? 10)
const OFFLINE_FAIL_THRESHOLD = Number(process.env.SEMANTIC_OFFLINE_FAIL_THRESHOLD ?? 5)

let timer: NodeJS.Timeout | null = null
let running = false

// Contador de falhas consecutivas em snapshot, in-memory (reset no boot é OK)
const snapshotFailCount = new Map<string, number>()

async function bumpSnapshotFails(ruleId: string): Promise<number> {
  const cur = (snapshotFailCount.get(ruleId) ?? 0) + 1
  snapshotFailCount.set(ruleId, cur)
  return cur
}
async function resetSnapshotFails(ruleId: string): Promise<void> {
  if (snapshotFailCount.has(ruleId)) snapshotFailCount.delete(ruleId)
}

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
  // ── 1. Gating + key resolution + LGPD + quota (P0 #1/#5/#14) ──────────
  const gate = await aiGatingService.checkAndOpen({
    cameraId: rule.cameraId,
    feature: 'semantic-rule',
  })

  if (!gate.allowed) {
    // Log + auto-pause se LGPD ou subscription falhou (não adianta tentar de novo)
    await aiGatingService.logBlock({ cameraId: rule.cameraId, feature: 'semantic-rule' }, gate)
    await prisma.semanticRule.update({
      where: { id: rule.id },
      data: {
        lastEvaluatedAt: new Date(),
        ...((gate.reason === 'no_subscription' || gate.reason === 'lgpd_block') ? {
          autoPaused: true,
          autoPausedAt: new Date(),
          autoPausedReason: gate.reason,
        } : {}),
      },
    }).catch(() => {})
    return
  }

  // ── 2. Câmera info pra snapshot ────────────────────────────────────────
  const camera = await prisma.camera.findUnique({
    where: { id: rule.cameraId },
    select: {
      id: true, name: true, active: true, aiEnabled: true, rtspMainUrl: true,
      site: { select: { clienteFinal: { select: { id: true, integradorId: true } } } },
    },
  })
  if (!camera || !camera.rtspMainUrl) {
    await prisma.semanticRule.update({
      where: { id: rule.id },
      data: { lastEvaluatedAt: new Date() },
    }).catch(() => {})
    return
  }

  // ── 3. Captura snapshot ────────────────────────────────────────────────
  let jpeg: Buffer
  try {
    jpeg = await captureSnapshot(camera.rtspMainUrl)
    await resetSnapshotFails(rule.id)  // reseta contador no sucesso
  } catch (err: any) {
    if (err instanceof FfmpegSnapshotError) {
      logger.warn({ ruleId: rule.id, code: err.code }, 'semantic_rule_snapshot_failed')
    }
    // P1 #9: Offline detection. Apos N falhas consecutivas, auto-pausa
    // regra + envia 1 alerta unico pro cliente ("sua camera esta offline").
    const fails = await bumpSnapshotFails(rule.id)
    const data: any = { lastEvaluatedAt: new Date() }
    if (fails >= OFFLINE_FAIL_THRESHOLD) {
      data.autoPaused = true
      data.autoPausedAt = new Date()
      data.autoPausedReason = 'camera_offline'
      logger.warn({ ruleId: rule.id, fails }, 'semantic_rule_auto_paused_offline')
      // Notifica 1 vez (dedup garante isso)
      const canNotify = await rateLimitDedup({
        scope: 'semantic-rule-offline', key: rule.id, channel: 'all', ttlSec: 3600,
      })
      if (canNotify && camera.site?.clienteFinal) {
        dispatchAlert({
          integradorId:   camera.site.clienteFinal.integradorId,
          clienteFinalId: camera.site.clienteFinal.id,
          title:          `📴 Regra pausada — câmera ${camera.name} offline`,
          body:           `A regra "${rule.prompt.slice(0, 60)}..." foi pausada após ${fails} tentativas. Reative quando a câmera voltar.`,
          cameraName:     camera.name,
          severity:       'WARNING',
        }).catch(() => {})
      }
    }
    await prisma.semanticRule.update({ where: { id: rule.id }, data }).catch(() => {})
    await aiGatingService.logCall(gate, { outcome: 'api_error', errorMessage: 'snapshot_failed' })
    return
  }

  // ── 4. Chama Gemini com key resolvida ──────────────────────────────────
  const evalResult = await evaluateSemanticRule(jpeg, rule.prompt)
  await prisma.semanticRule.update({
    where: { id: rule.id },
    data: { lastEvaluatedAt: new Date() },
  }).catch(() => {})

  // ── 5. Log da call (P0 #2) ─────────────────────────────────────────────
  await aiGatingService.logCall(gate, {
    tokensIn: 612,     // approx snapshot 720p; refinar com response.usageMetadata se quisermos
    tokensOut: 88,
    outcome: evalResult ? 'success' : 'api_error',
    errorMessage: evalResult ? undefined : 'evaluate_returned_null',
  })

  if (!evalResult || !evalResult.matches) return

  // ── 6. Dedup notificação (P0 #4) ───────────────────────────────────────
  const canNotify = await rateLimitDedup({
    scope: 'semantic-rule',
    key: rule.id,
    channel: 'all',
  })

  await prisma.semanticRule.update({
    where: { id: rule.id },
    data: {
      lastFiredAt: new Date(),
      fireCount:   { increment: 1 },
    },
  }).catch(() => {})

  logger.info({
    ruleId: rule.id, cameraId: rule.cameraId, fireCount: rule.fireCount + 1, willNotify: canNotify,
  }, 'semantic_rule_fired')

  if (!canNotify) return  // disparou mas suprime alerta (dedup ativa)

  // ── 7. Dispara alerta ──────────────────────────────────────────────────
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
        autoPaused: false,  // P1 #8 — pula regras auto-pausadas (FP excessivo, LGPD, etc)
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
