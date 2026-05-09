/**
 * sprite-backfill-worker — job periódico que detecta horas com gravação
 * mas sem sprite e gera Cloud-side via ffmpeg.
 *
 * Garante que o operador NUNCA fica sem preview no hover, mesmo se a Box
 * falhar em uploadar sprite (rede, ffmpeg crash, etc).
 *
 * Padrão de execução:
 *   - Roda a cada SPRITE_BACKFILL_INTERVAL_SEC (default 300s = 5min)
 *   - Processa max SPRITE_BACKFILL_BATCH_SIZE itens por ciclo (default 5)
 *   - Skip horas com idade < SPRITE_BACKFILL_GRACE_MIN (default 10min) —
 *     dá tempo da Box tentar primeiro
 *   - Skip se outro ciclo está em andamento (lock simples in-memory)
 *
 * Custo por item: ~10-25s (download segments + extract 120 frames + tile).
 * Batch de 5 itens roda em ~2min, dentro da janela de 5min do próximo tick.
 */
import { spriteGenerator } from './sprite-generator.service'
import { logger } from '../lib/logger'

const INTERVAL_SEC  = parseInt(process.env.SPRITE_BACKFILL_INTERVAL_SEC ?? '300', 10)
const BATCH_SIZE    = parseInt(process.env.SPRITE_BACKFILL_BATCH_SIZE   ?? '5', 10)
const SINCE_DAYS    = parseInt(process.env.SPRITE_BACKFILL_SINCE_DAYS   ?? '7', 10)
const ENABLED       = process.env.SPRITE_BACKFILL_ENABLED !== 'false'  // default ON

let timer: NodeJS.Timeout | null = null
let running = false

async function tick(): Promise<void> {
  if (running) {
    logger.debug('sprite_backfill_skip_overlap')
    return
  }
  running = true
  const t0 = Date.now()
  try {
    const pending = await spriteGenerator.findHoursMissingSprite({
      sinceDays: SINCE_DAYS,
      limit:     BATCH_SIZE,
    })
    if (pending.length === 0) {
      logger.debug('sprite_backfill_no_pending')
      return
    }

    let ok = 0, fail = 0, regenerated = 0
    for (const p of pending) {
      try {
        // Sprite incompleto (frameCount < threshold) → força regeneração.
        // Sem isso, sprites criados com poucos segments uploaded ficavam
        // permanentemente incompletos (existing && !force = early return).
        const r = await spriteGenerator.generateForHour(p.cameraId, p.day, p.hour, {
          force: p.needsRegen,
        })
        if (r.ok) {
          ok++
          if (p.needsRegen) regenerated++
        } else {
          fail++
        }
        if (!r.ok) {
          logger.debug({ cameraId: p.cameraId, day: p.day, hour: p.hour, reason: r.reason },
            'sprite_backfill_item_skip')
        }
      } catch (err) {
        fail++
        logger.warn({ err, cameraId: p.cameraId, day: p.day, hour: p.hour },
          'sprite_backfill_item_error')
      }
    }
    logger.info({
      total: pending.length, ok, fail, regenerated,
      elapsedMs: Date.now() - t0,
    }, 'sprite_backfill_tick_done')
  } catch (err) {
    logger.error({ err }, 'sprite_backfill_tick_error')
  } finally {
    running = false
  }
}

export function startSpriteBackfillWorker(): void {
  if (!ENABLED) {
    logger.info('sprite_backfill_disabled (SPRITE_BACKFILL_ENABLED=false)')
    return
  }
  if (timer != null) return
  // Primeiro tick após 60s (bootstrap settle); depois cada INTERVAL_SEC.
  setTimeout(() => { tick().catch(() => {}) }, 60_000)
  timer = setInterval(() => { tick().catch(() => {}) }, INTERVAL_SEC * 1000)
  timer.unref()
  logger.info({ intervalSec: INTERVAL_SEC, batchSize: BATCH_SIZE, sinceDays: SINCE_DAYS },
    'sprite_backfill_started')
}

export function stopSpriteBackfillWorker(): void {
  if (timer != null) {
    clearInterval(timer)
    timer = null
  }
}
