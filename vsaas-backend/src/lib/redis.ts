/**
 * Redis client singleton — compartilhado entre todos os serviços do backend.
 *
 * A instância Redis no stack (redis:6379) é compartilhada com a Evolution API
 * (CACHE_REDIS_PREFIX_KEY="evolution"). Para evitar colisão de chaves, todos os
 * nossos keys usam o prefixo "icv:".
 *
 * IMPORTANTE — eviction policy:
 *   O Redis está configurado com `--maxmemory-policy allkeys-lru`. Isso significa
 *   que Redis pode despejar QUALQUER chave (mesmo sem TTL) sob pressão de memória.
 *   Por isso TODAS as chaves do recorder e do ingest DEVEM ter TTL.
 *   As chaves de recorder state são keepalive via heartbeat — se o TTL expirar
 *   sem renovação, significa que o processo dono morreu (safety net correto).
 *
 * Lazy connect:
 *   ioredis conecta automaticamente no primeiro comando. Se Redis não estiver
 *   disponível, os comandos falham com erro — os callers tratam defensivamente.
 *   Não bloqueamos o boot do processo por Redis indisponível.
 */
import Redis from 'ioredis'
import { logger } from './logger'

const REDIS_URL = process.env.REDIS_URL ?? 'redis://redis:6379'

let _client: Redis | null = null

export function getRedis(): Redis {
  if (_client) return _client

  _client = new Redis(REDIS_URL, {
    // Prefixo automático em todos os comandos — nunca colide com Evolution.
    keyPrefix: 'icv:',
    // Timeout agressivo: Redis deve ser sempre rápido; se demorar >1s algo está errado.
    commandTimeout: 1000,
    // Não reconecta infinitamente — evita log spam se Redis estiver down.
    maxRetriesPerRequest: 2,
    // Reconecta com backoff exponencial mas teto baixo (serviço local).
    retryStrategy(times: number) {
      if (times > 5) return null  // desiste após 5 tentativas
      return Math.min(times * 200, 2000)
    },
    lazyConnect: true,
    enableOfflineQueue: false,  // falha imediato se desconectado — não acumula
  })

  _client.on('error', (err) => {
    // Log apenas errors críticos — connection refused é esperado em dev sem Redis
    if ((err as any).code !== 'ECONNREFUSED') {
      logger.warn({ err: err.message }, 'redis_error')
    }
  })

  _client.on('connect', () => logger.info({ url: REDIS_URL }, 'redis_connected'))

  return _client
}

/** Fecha a conexão — chamar no SIGTERM/SIGINT do processo. */
export async function closeRedis(): Promise<void> {
  if (_client) {
    await _client.quit().catch(() => {})
    _client = null
  }
}
