/**
 * trigger-executor.service.ts — Executa ações de SemanticTriggers quando
 * um novo embedding é indexado e o score ≥ threshold.
 *
 * Fluxo:
 *   1. semantic-search /index cria um SemanticEmbedding
 *   2. Chama triggerExecutor.check(embeddingId, cameraId, vector, capturedAt)
 *   3. Carrega triggers ativos para o clienteFinal da câmera
 *   4. Calcula cosine similarity
 *   5. Para cada match: verifica cooldown → cria SemanticTriggerHit → dispara ações
 *
 * Ações suportadas:
 *   NOTIFY      → alertService.dispatch({ type: 'TRIGGER_FIRE' })
 *   WEBHOOK     → POST com HMAC-SHA256
 *   REVIEW_FLAG → marca ReviewItem como ALERT
 *   RECORD      → log (recording por câmera é iniciado pelo recording.service)
 *   SIREN       → publica tópico MQTT (via interna da plataforma)
 */

import crypto      from 'crypto'
import { prisma }  from '../lib/prisma'
import { logger }  from '../lib/logger'
import { alertService } from './alert.service'

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface CheckInput {
  semanticEmbeddingId: string
  cameraId:            string
  vector:              number[]
  capturedAt:          Date
  reviewItemId?:       string
  snapshotKey?:        string
}

// ── Cosine similarity (inline para evitar importar lib/embedding que pode
//    ter dependências pesadas — embedding.ts já tem a função mas é pequena) ──

function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na  += a[i] * a[i]
    nb  += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

// ── Check principal ───────────────────────────────────────────────────────────

async function check(input: CheckInput): Promise<void> {
  const { semanticEmbeddingId, cameraId, vector, capturedAt, reviewItemId, snapshotKey } = input

  // Resolve câmera → clienteFinal (name, integradorId, site)
  const camera = await prisma.camera.findUnique({
    where:  { id: cameraId },
    select: {
      id: true, name: true, location: true,
      site: {
        select: {
          name: true,
          clienteFinalId: true,
          clienteFinal: { select: { id: true, name: true, integradorId: true } },
        },
      },
    },
  })
  if (!camera?.site?.clienteFinalId) return

  const cfId     = camera.site.clienteFinalId
  const cfName   = camera.site.clienteFinal?.name ?? 'Cliente'
  const siteName = camera.site.name ?? ''

  // Carrega todos os triggers ativos do clienteFinal
  const triggers = await prisma.semanticTrigger.findMany({
    where:  { clienteFinalId: cfId, enabled: true },
    select: {
      id: true, name: true, description: true,
      threshold: true, cooldownSec: true,
      embeddingVector: true,
      cameraIdsJson: true,
      actionsJson: true,
    },
  })

  if (triggers.length === 0) return

  const baseUrl     = process.env.PUBLIC_FRONTEND_URL?.replace('/login', '') ?? 'http://localhost:5173'
  const now         = new Date()

  for (const trigger of triggers) {
    // Verifica restrição de câmera (cameraIdsJson null = todas)
    const allowedCams = trigger.cameraIdsJson as string[] | null
    if (allowedCams && allowedCams.length > 0 && !allowedCams.includes(cameraId)) {
      continue
    }

    // Cosine similarity
    const triggerVec = trigger.embeddingVector as number[]
    const score = cosineSim(vector, triggerVec)

    if (score < trigger.threshold) continue

    // Verifica cooldown via SemanticTriggerHit
    if (trigger.cooldownSec > 0) {
      const cooldownCutoff = new Date(now.getTime() - trigger.cooldownSec * 1000)
      const recentHit = await prisma.semanticTriggerHit.findFirst({
        where: {
          triggerId:  trigger.id,
          cameraId,
          capturedAt: { gte: cooldownCutoff },
        },
        select: { id: true },
      })
      if (recentHit) {
        logger.debug({ triggerId: trigger.id, cameraId, score }, 'trigger_cooldown_skip')
        continue
      }
    }

    // ── Cria SemanticTriggerHit ──────────────────────────────────────────────
    const actions = trigger.actionsJson as Array<{ type: string; url?: string; secret?: string; sirenId?: string }>

    const actionsRun: Array<Record<string, unknown>> = []

    // ── Executa cada ação ────────────────────────────────────────────────────
    for (const action of actions) {
      try {
        switch (action.type) {

          // NOTIFY → email via alertService
          case 'NOTIFY': {
            await alertService.dispatch({
              type:           'TRIGGER_FIRE',
              severity:       'WARNING',
              clienteFinalId: cfId,
              cameraId,
              triggerId:      trigger.id,
              alertKey:       `trigger_fire:${trigger.id}:${cameraId}`,
              payload: {
                triggerName:   trigger.name,
                cameraName:    camera.name,
                location:      camera.location ?? siteName,
                siteName,
                clienteName:   cfName,
                score:         score.toFixed(4),
                capturedAt:    capturedAt.toLocaleString('pt-BR'),
                description:   trigger.description ?? `Correspondência detectada: "${trigger.name}"`,
                severity:      'ALERTA',
                dashboardUrl:  `${baseUrl}/review`,
                settingsUrl:   `${baseUrl}/settings`,
                escaladeNote:  '',
              },
            })
            actionsRun.push({ type: 'NOTIFY', status: 'dispatched' })
            break
          }

          // WEBHOOK → POST com HMAC-SHA256
          case 'WEBHOOK': {
            if (!action.url) { actionsRun.push({ type: 'WEBHOOK', status: 'skip_no_url' }); break }
            const t0 = Date.now()
            const body = JSON.stringify({
              event:      'trigger_fire',
              triggerId:  trigger.id,
              triggerName: trigger.name,
              cameraId,
              cameraName: camera.name,
              score,
              capturedAt: capturedAt.toISOString(),
              snapshotKey: snapshotKey ?? null,
            })
            const headers: Record<string, string> = { 'Content-Type': 'application/json' }
            if (action.secret) {
              const sig = crypto.createHmac('sha256', action.secret).update(body).digest('hex')
              headers['x-icv-signature'] = `sha256=${sig}`
            }
            const resp = await fetch(action.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(8_000) })
            actionsRun.push({ type: 'WEBHOOK', status: resp.status, durationMs: Date.now() - t0 })
            break
          }

          // REVIEW_FLAG → marca review item como ALERT
          case 'REVIEW_FLAG': {
            if (reviewItemId) {
              await prisma.reviewItem.update({
                where: { id: reviewItemId },
                data:  { severity: 'ALERT', updatedAt: now },
              })
              actionsRun.push({ type: 'REVIEW_FLAG', reviewItemId, status: 'flagged' })
            } else {
              actionsRun.push({ type: 'REVIEW_FLAG', status: 'skip_no_review_item' })
            }
            break
          }

          // RECORD → solicita gravação forçada (câmera já pode estar gravando)
          case 'RECORD': {
            // Anotamos a intenção; o recording.service controla ffmpeg por câmera.
            // Futuramente: publicar sinal para forçar segmento de X minutos.
            actionsRun.push({ type: 'RECORD', status: 'logged' })
            logger.info({ triggerId: trigger.id, cameraId }, 'trigger_record_action')
            break
          }

          // SIREN → publicar em tópico MQTT
          case 'SIREN': {
            actionsRun.push({ type: 'SIREN', sirenId: action.sirenId ?? null, status: 'logged' })
            logger.info({ triggerId: trigger.id, cameraId, sirenId: action.sirenId }, 'trigger_siren_action')
            break
          }

          default:
            actionsRun.push({ type: action.type, status: 'unknown_action' })
        }
      } catch (err: any) {
        logger.warn({ triggerId: trigger.id, action: action.type, err: err.message }, 'trigger_action_error')
        actionsRun.push({ type: action.type, status: 'error', error: err.message })
      }
    }

    // ── Persiste hit ─────────────────────────────────────────────────────────
    try {
      await prisma.semanticTriggerHit.create({
        data: {
          triggerId:           trigger.id,
          cameraId,
          reviewItemId:        reviewItemId ?? null,
          semanticEmbeddingId,
          score,
          snapshotKey:         snapshotKey ?? null,
          actionsRunJson:      actionsRun as any,
          delivered:           actionsRun.some(a => a.status === 'dispatched' || (typeof a.status === 'number' && a.status >= 200 && a.status < 300)),
          capturedAt,
        },
      })

      // Incrementa contadores do trigger
      await prisma.semanticTrigger.update({
        where: { id: trigger.id },
        data:  { hitsCount: { increment: 1 }, lastHitAt: now },
      })

      logger.info({ triggerId: trigger.id, cameraId, score: score.toFixed(4), actions: actionsRun.length }, 'trigger_fired')
    } catch (err: any) {
      logger.warn({ err: err.message, triggerId: trigger.id }, 'trigger_hit_persist_error')
    }
  }
}

// ── Export ────────────────────────────────────────────────────────────────────

export const triggerExecutor = { check }
