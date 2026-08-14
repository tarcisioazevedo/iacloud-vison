/**
 * canUse() — função central de verificação de capabilities.
 *
 * Pergunta: "esse clienteFinal pode exercer essa capability AGORA?"
 *
 * Responde considerando:
 *   - Capability core: sempre permitido
 *   - Subscription ACTIVE: libera capabilities do produto
 *   - Subscription GRACE: NÃO libera (cliente cancelou, está só em fade-out)
 *   - Subscription CANCELED / SUSPENDED / PENDING: NÃO libera
 *
 * Performance:
 *   - Cache Redis (set) por clienteFinalId com TTL de 60s
 *   - Cache invalidado automaticamente via hook do Prisma quando
 *     ClienteSubscription muda de estado.
 *
 * Uso:
 *   import { canUse } from './lib/capability-check'
 *   import { CAPABILITIES } from './lib/capabilities'
 *
 *   if (await canUse(clienteFinalId, CAPABILITIES.STORAGE_RECORDING_CONTINUOUS)) {
 *     // libera
 *   }
 *
 * Fonte: docs/32-IMPLEMENTACAO-CAPABILITY-GATING.md
 */
import { prisma } from './prisma'
import { getRedis } from './redis'
import { logger } from './logger'
import { CORE_CAPABILITIES } from './capabilities'

const CACHE_TTL_SECONDS = 60
const CACHE_KEY = (clienteId: string) => `caps:${clienteId}`
const EMPTY_MARKER = '__none__'

/**
 * Verifica se um cliente final tem permissão para usar uma capability.
 *
 * @param clienteFinalId UUID do cliente
 * @param capability ex: 'storage.recording.continuous'
 * @returns true se permitido, false se bloqueado
 */
export async function canUse(
  clienteFinalId: string | null | undefined,
  capability: string,
): Promise<boolean> {
  // Core: sempre permitido, independente de cliente
  if (CORE_CAPABILITIES.has(capability)) return true

  // Sem cliente → não há subscription → nega
  if (!clienteFinalId) return false

  const r = getRedis()
  const key = CACHE_KEY(clienteFinalId)

  try {
    // 1. Tenta cache (SISMEMBER é O(1))
    const exists = await r.exists(key)
    if (exists === 1) {
      const isMember = await r.sismember(key, capability)
      return isMember === 1
    }

    // 2. Cache miss: carrega do banco
    const caps = await loadCapabilitiesForCliente(clienteFinalId)

    // 3. Popula cache
    const pipe = r.pipeline()
    if (caps.length > 0) {
      pipe.sadd(key, ...caps)
    } else {
      pipe.sadd(key, EMPTY_MARKER)
    }
    pipe.expire(key, CACHE_TTL_SECONDS)
    await pipe.exec()

    return caps.includes(capability)
  } catch (err) {
    // Fallback: se Redis falhar, consulta banco direto (degrada performance, mas mantém correto)
    logger.warn({ err, clienteFinalId, capability }, 'canUse_redis_error_fallback_db')
    const caps = await loadCapabilitiesForCliente(clienteFinalId)
    return caps.includes(capability)
  }
}

/**
 * Versão que aceita múltiplas capabilities (AND lógico).
 * Retorna true APENAS se cliente tem TODAS.
 */
export async function canUseAll(
  clienteFinalId: string | null | undefined,
  capabilities: string[],
): Promise<boolean> {
  for (const cap of capabilities) {
    if (!(await canUse(clienteFinalId, cap))) return false
  }
  return true
}

/**
 * Versão que aceita múltiplas capabilities (OR lógico).
 * Retorna true se cliente tem PELO MENOS UMA.
 */
export async function canUseAny(
  clienteFinalId: string | null | undefined,
  capabilities: string[],
): Promise<boolean> {
  for (const cap of capabilities) {
    if (await canUse(clienteFinalId, cap)) return true
  }
  return false
}

/**
 * Retorna lista completa de capabilities ativas do cliente.
 * Usado pelo endpoint /me/cliente/capabilities (frontend HOC).
 */
export async function listCapabilitiesForCliente(clienteFinalId: string): Promise<string[]> {
  const r = getRedis()
  const key = CACHE_KEY(clienteFinalId)

  try {
    const cached = await r.smembers(key)
    if (cached.length > 0) {
      return cached.filter(c => c !== EMPTY_MARKER)
    }
  } catch (err) {
    logger.warn({ err, clienteFinalId }, 'listCapabilities_redis_error')
  }

  return loadCapabilitiesForCliente(clienteFinalId)
}

/**
 * Carrega capabilities ativas do cliente direto do banco.
 * Agrega de TODAS as subscriptions ACTIVE.
 *
 * IMPORTANTE: GRACE/CANCELED/SUSPENDED/PENDING NÃO contam.
 * - GRACE = cliente cancelou; dados ficam por 30d mas serviço não roda mais
 * - CANCELED = graça expirou
 * - SUSPENDED = bloqueado por inadimplência
 * - PENDING = aguardando aprovação do integrador
 */
async function loadCapabilitiesForCliente(clienteFinalId: string): Promise<string[]> {
  const subs = await prisma.clienteSubscription.findMany({
    where: {
      clienteFinalId,
      // TRIAL precisa contar — é o objetivo do grantTrial() (ver
      // subscription-trial.service.ts). GRACE também: cancelado mas ainda
      // dentro do período de graça não perdeu acesso (mesmo critério já
      // usado na quota de regras semânticas em routes/semantic-rules.ts).
      status: { in: ['ACTIVE', 'TRIAL', 'GRACE'] },
    },
    select: {
      productId: true,
      product: {
        select: { capabilities: true },
      },
    },
  })

  // Une capabilities de todas as subs ativas
  const all = new Set<string>()
  for (const s of subs) {
    for (const cap of s.product.capabilities) {
      all.add(cap)
    }
  }

  return Array.from(all)
}

/**
 * Invalida cache de capabilities de um cliente.
 * Chamar SEMPRE que ClienteSubscription mudar (create/update/delete).
 *
 * O hook do Prisma em lib/prisma.ts já faz isso automaticamente,
 * mas exposto pra casos manuais (admin grants, scripts de migração).
 */
export async function invalidateCapabilityCache(clienteFinalId: string): Promise<void> {
  if (!clienteFinalId) return
  try {
    await getRedis().del(CACHE_KEY(clienteFinalId))
    logger.debug({ clienteFinalId }, 'capability_cache_invalidated')
  } catch (err) {
    logger.warn({ err, clienteFinalId }, 'capability_cache_invalidate_failed')
  }
}

/**
 * Invalida cache para múltiplos clientes (bulk ops).
 */
export async function invalidateCapabilityCacheBulk(clienteFinalIds: string[]): Promise<void> {
  if (clienteFinalIds.length === 0) return
  try {
    const keys = clienteFinalIds.filter(Boolean).map(id => CACHE_KEY(id))
    if (keys.length > 0) await getRedis().del(...keys)
  } catch (err) {
    logger.warn({ err, count: clienteFinalIds.length }, 'capability_cache_invalidate_bulk_failed')
  }
}
