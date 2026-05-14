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
import { getRedis } from '../lib/redis'

const INTERVAL_SEC  = parseInt(process.env.SPRITE_BACKFILL_INTERVAL_SEC ?? '300', 10)
const BATCH_SIZE    = parseInt(process.env.SPRITE_BACKFILL_BATCH_SIZE   ?? '5', 10)
const SINCE_DAYS    = parseInt(process.env.SPRITE_BACKFILL_SINCE_DAYS   ?? '7', 10)
const ENABLED       = process.env.SPRITE_BACKFILL_ENABLED !== 'false'  // default ON

// Lock distribuído: chave Redis SET NX EX. Com 2+ réplicas backend, sem isso
// AMBAS rodavam o backfill simultaneamente → ffmpeg duplicado, race em UPSERT
// SpriteSheet, custo dobrado. TTL 240s cobre 1 tick completo + buffer.
// Se a réplica que pegou o lock morrer, a chave expira e outra assume.
const LOCK_KEY = 'icv:sprite_backfill:lock'
const LOCK_TTL_SEC = 240

let timer: NodeJS.Timeout | null = null

async function acquireLock(holderId: string): Promise<boolean> {
  try {
    const redis = getRedis()
    const r = await redis.set(LOCK_KEY, holderId, 'EX', LOCK_TTL_SEC, 'NX')
    return r === 'OK'
  } catch (err) {
    // Redis indisponível — log e segue (mantém comportamento legado sem lock,
    // pois sprite-backfill é melhor "duplicado em raras situações" do que parado)
    logger.warn({ err }, 'sprite_backfill_redis_unavailable_no_lock')
    return true  // fallback: deixa rodar
  }
}

async function releaseLock(holderId: string): Promise<void> {
  try {
    const redis = getRedis()
    // Só libera se ainda for o dono (proteção contra release do TTL expirado)
    const script = `
      if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('DEL', KEYS[1])
      end
      return 0
    `
    await redis.eval(script, 1, LOCK_KEY, holderId)
  } catch {}
}

// holderId identifica a réplica que segura o lock (hostname + pid).
// Útil pra debug em logs.
const HOLDER_ID = `${process.env.HOSTNAME ?? 'unknown'}:${process.pid}`

async function tick(): Promise<void> {
  const acquired = await acquireLock(HOLDER_ID)
  if (!acquired) {
    logger.debug('sprite_backfill_skip_locked_by_other_replica')
    return
  }
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
    const failReasons: Record<string, number> = {}
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
          // Agrega motivos de falha pra log resumido (em vez de N linhas debug)
          const reason = r.reason ?? 'unknown'
          failReasons[reason] = (failReasons[reason] ?? 0) + 1
        }
      } catch (err) {
        fail++
        logger.warn({ err, cameraId: p.cameraId, day: p.day, hour: p.hour },
          'sprite_backfill_item_error')
      }
    }
    logger.info({
      total: pending.length, ok, fail, regenerated,
      failReasons: fail > 0 ? failReasons : undefined,
      elapsedMs: Date.now() - t0,
      holder: HOLDER_ID,
    }, 'sprite_backfill_tick_done')
  } catch (err) {
    logger.error({ err }, 'sprite_backfill_tick_error')
  } finally {
    await releaseLock(HOLDER_ID)
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
