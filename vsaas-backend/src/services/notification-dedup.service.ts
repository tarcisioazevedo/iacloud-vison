/**
 * notification-dedup.service.ts — rate-limit/dedup de notificações via Redis.
 *
 * Endereça P0 GAP #4: sem dedup, uma regra com FP em loop dispara 1440
 * WhatsApps/dia. Cliente cancela.
 *
 * Estratégia:
 *   - Para cada combinação (scope, key, channel), guarda timestamp Redis
 *   - Se janela TTL ainda aberta, retorna false (não envia)
 *   - Default: 5min dedup; configurável via env DISPATCH_DEDUP_SEC
 *
 * Uso:
 *   const ok = await rateLimitDedup({
 *     scope: 'semantic-rule',
 *     key: rule.id,
 *     channel: 'whatsapp',
 *   })
 *   if (!ok) return  // já notificado recentemente
 *   await dispatchAlert(...)
 */
import { getRedis } from '../lib/redis'
import { logger } from '../lib/logger'

const DEFAULT_TTL = Number(process.env.DISPATCH_DEDUP_SEC ?? 300) // 5 min
const KEY_PREFIX = 'icv:notif-dedup:'

export interface DedupArgs {
  scope:   string  // 'semantic-rule' | 'lpr' | 'detection-event' etc
  key:     string  // id da regra, placa, evento
  channel?: string // 'whatsapp' | 'push' | 'email' | 'all'
  ttlSec?:  number
}

export async function rateLimitDedup(args: DedupArgs): Promise<boolean> {
  const ttl = args.ttlSec ?? DEFAULT_TTL
  const redisKey = `${KEY_PREFIX}${args.scope}:${args.key}:${args.channel ?? 'all'}`
  try {
    const redis = getRedis()
    // SET key value NX EX ttl -> retorna OK se setou, null se já existia
    const ok = await redis.set(redisKey, '1', 'EX', ttl, 'NX')
    return ok === 'OK'
  } catch (err: any) {
    // Falha do Redis nao deve bloquear notificacao (failsafe: deixa passar)
    logger.warn({ err: err.message, redisKey }, 'notification_dedup_redis_failed')
    return true
  }
}

/** Reseta o dedup pra uma chave (uso: operador clica 'enviar de novo'). */
export async function resetDedup(args: DedupArgs): Promise<void> {
  const redisKey = `${KEY_PREFIX}${args.scope}:${args.key}:${args.channel ?? 'all'}`
  try {
    const redis = getRedis()
    await redis.del(redisKey)
  } catch { /* ignore */ }
}
