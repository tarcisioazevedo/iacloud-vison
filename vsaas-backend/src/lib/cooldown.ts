/**
 * Sprint Q.5 — Cooldown anti-spam para notificações.
 *
 * Frigate publica events em rajada (1 review item pode gerar 30+ updates de
 * estado). Sem cooldown, usuário recebe 30 push notifications para o mesmo
 * evento. Frigate resolve isso com `cooldown` por câmera (ver
 * `notification.py`: `webpush.py` faz set NX em Redis).
 *
 * Implementação atual: in-memory Map com TTL — adequado para single-instance.
 * Para multi-instance (HA) trocar por Redis SET key NX EX n.
 *
 * Reliability:
 * - GC periódico (a cada 5 min) limpa entradas expiradas — sem leak.
 * - Não persiste entre restart — perda aceitável (cooldown é "best-effort").
 * - Testes determinísticos: clock injetável via `nowFn`.
 */
import { logger } from './logger'

interface CooldownEntry {
  expiresAt: number
}

const store = new Map<string, CooldownEntry>()

let nowFn: () => number = Date.now

// Para testes
export function __setClock(fn: () => number): void {
  nowFn = fn
}
export function __clearAll(): void {
  store.clear()
}

/**
 * Tenta adquirir o lock. Retorna true se DEVE notificar (lock adquirido),
 * false se está em cooldown e a notificação deve ser suprimida.
 *
 * Semântica: SET key NX EX cooldownSec. Idempotente sob race condition no
 * mesmo processo (Map é single-thread).
 */
export function tryAcquire(key: string, cooldownSec: number): boolean {
  if (cooldownSec <= 0) return true
  const now = nowFn()
  const existing = store.get(key)
  if (existing && existing.expiresAt > now) {
    return false
  }
  store.set(key, { expiresAt: now + cooldownSec * 1000 })
  return true
}

/**
 * Tempo restante do cooldown em segundos. 0 = livre.
 */
export function remainingSec(key: string): number {
  const entry = store.get(key)
  if (!entry) return 0
  const ms = entry.expiresAt - nowFn()
  return ms > 0 ? Math.ceil(ms / 1000) : 0
}

/**
 * Reseta o cooldown — útil para botão "testar agora" da UI.
 */
export function reset(key: string): void {
  store.delete(key)
}

// GC periódico — evita unbounded growth.
const GC_INTERVAL_MS = 5 * 60_000
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    const now = nowFn()
    let removed = 0
    for (const [k, v] of store) {
      if (v.expiresAt <= now) {
        store.delete(k)
        removed++
      }
    }
    if (removed > 0) {
      logger.debug({ removed, remaining: store.size }, 'cooldown_gc')
    }
  }, GC_INTERVAL_MS).unref() // unref → não impede shutdown
}
