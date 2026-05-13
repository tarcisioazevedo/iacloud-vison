/**
 * Recorder State — estado distribuído de gravações via Redis.
 *
 * Resolve os dois problemas estruturais que impediam multi-réplica:
 *   1. `active Map` em memória → não compartilhado entre processos
 *   2. Race condition em startRecording → dois processos podiam spawnar
 *      ffmpeg para a mesma câmera simultaneamente
 *
 * Schema Redis (todos os keys com TTL — compatível com allkeys-lru):
 *
 *   icv:rec:starting:{cameraId}   TTL=20s   Lock atômico de início.
 *     Adquirido antes de detectCodec (~3-6s) + spawn. Liberado quando
 *     active key é setado. Garante que só 1 réplica inicia por câmera.
 *
 *   icv:rec:active:{cameraId}     TTL=90s   Câmera gravando.
 *     Setado após ffmpeg spawnar. Renovado a cada 30s via heartbeat.
 *     Se TTL expirar sem renovação → processo dono morreu (safety net).
 *     Value = JSON com metadata (replicaId, streamKey, startedAt).
 *
 *   icv:rec:pending:{cameraId}    TTL=6s    Janela de restart (3s + buffer).
 *     Setado quando ffmpeg sai com willAutoRestart=true.
 *     Expira automaticamente — sem cleanup manual necessário.
 *
 * Operações atômicas via Lua:
 *   acquireStartLock usa script Lua para check-and-set atômico. Sem isso,
 *   duas réplicas poderiam passar pelo check ao mesmo tempo e ambas
 *   tentariam iniciar a gravação (TOCTOU race condition).
 *
 * Fallback defensivo:
 *   Toda operação Redis tem try/catch. Se Redis estiver down, o sistema
 *   degrada para comportamento single-replica (Map local) sem crash.
 *   A garantia de "sem duplicata" é best-effort quando Redis está fora.
 */
import { getRedis } from './redis'

/** Identificador único desta instância do processo — gerado no boot. */
export const REPLICA_ID = `${process.pid}-${Date.now()}`

// TTLs em segundos
const TTL_STARTING  = 20   // tempo máximo para detectCodec + spawn
const TTL_ACTIVE    = 90   // heartbeat renova a cada 30s
const TTL_PENDING   = 6    // janela de 3s + buffer de segurança

export interface ActiveRecordingMeta {
  replicaId:    string
  streamKey:    string
  integradorId: string
  codec:        string
  segDir:       string
  startedAt:    number  // unix ms
}

// ── Lua script: adquire lock de início atômico ────────────────────────────
// Verifica active E pending antes de tentar SET NX no starting lock.
// Toda a operação é atômica no Redis — sem TOCTOU.
//
// KEYS[1] = starting key (com prefixo já aplicado pelo ioredis)
// KEYS[2] = active key
// KEYS[3] = pending key
// ARGV[1] = replicaId
// ARGV[2] = TTL em segundos
// Retorna: 1 se lock adquirido, 0 se já há gravação/pending/starting
const LUA_ACQUIRE_START = `
  local active  = redis.call('EXISTS', KEYS[2])
  local pending = redis.call('EXISTS', KEYS[3])
  if active == 1 or pending == 1 then
    return 0
  end
  local res = redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', ARGV[2])
  if res then return 1 else return 0 end
`

// ioredis precisa do script definido antes do eval — usamos defineCommand via
// eval direto pra compatibilidade sem precisar de custom command registration.

function key(prefix: string, cameraId: string): string {
  // Nota: ioredis já aplica 'icv:' globalmente via keyPrefix no cliente.
  // Aqui usamos apenas a parte após o prefixo global.
  return `${prefix}${cameraId}`
}

/**
 * Tenta adquirir o lock de início para uma câmera.
 * Retorna true se adquiriu (pode prosseguir com startRecording).
 * Retorna false se outra réplica já está iniciando, ativa ou em restart.
 */
export async function acquireStartLock(cameraId: string): Promise<boolean> {
  try {
    const redis = getRedis()
    // ioredis adiciona keyPrefix automaticamente antes de passar pro Redis.
    // No script Lua, os KEYS chegam JÁ com o prefixo → correto.
    const result = await redis.eval(
      LUA_ACQUIRE_START,
      3,
      key('rec:starting:', cameraId),
      key('rec:active:', cameraId),
      key('rec:pending:', cameraId),
      REPLICA_ID,
      String(TTL_STARTING),
    ) as number
    return result === 1
  } catch {
    // Redis down → fallback: permite iniciar (sem garantia distribuída)
    return true
  }
}

/** Libera o lock de início (chamado após setActive ou em caso de erro). */
export async function releaseStartLock(cameraId: string): Promise<void> {
  try {
    await getRedis().del(key('rec:starting:', cameraId))
  } catch { /* ignora — TTL de 20s limpa automaticamente */ }
}

/** Marca câmera como ativamente gravando nesta réplica. TTL=90s. */
export async function setActive(cameraId: string, meta: ActiveRecordingMeta): Promise<void> {
  try {
    // ioredis v5: set(key, value, 'EX', seconds) para SET com TTL
    await getRedis().set(key('rec:active:', cameraId), JSON.stringify(meta), 'EX', TTL_ACTIVE)
  } catch { /* ignora — heartbeat tentará novamente em 30s */ }
}

/** Renova TTL do active key (heartbeat — chamar a cada 30s). */
export async function refreshActive(cameraId: string): Promise<void> {
  try {
    await getRedis().expire(key('rec:active:', cameraId), TTL_ACTIVE)
  } catch { /* ignora */ }
}

/** Remove active key quando gravação encerra. */
export async function clearActive(cameraId: string): Promise<void> {
  try {
    await getRedis().del(key('rec:active:', cameraId))
  } catch { /* ignora */ }
}

/**
 * Verifica se alguma réplica está gravando esta câmera.
 * Para multi-réplica: cross-process check via Redis.
 * Callers devem também checar o Map local para fast-path síncrono.
 */
export async function isActiveAnywhere(cameraId: string): Promise<boolean> {
  try {
    return (await getRedis().exists(key('rec:active:', cameraId))) === 1
  } catch {
    return false  // Redis down → assume não ativo (conservador)
  }
}

/** Marca câmera em janela de restart (3s). TTL auto-expira após 6s. */
export async function setPending(cameraId: string): Promise<void> {
  try {
    await getRedis().set(key('rec:pending:', cameraId), REPLICA_ID, 'EX', TTL_PENDING)  // auto-expira
  } catch { /* ignora */ }
}

/** Remove pending manualmente (antes do TTL expirar, ao reiniciar). */
export async function clearPending(cameraId: string): Promise<void> {
  try {
    await getRedis().del(key('rec:pending:', cameraId))
  } catch { /* ignora */ }
}

/** Verifica se câmera está em janela de restart em qualquer réplica. */
export async function isPendingAnywhere(cameraId: string): Promise<boolean> {
  try {
    return (await getRedis().exists(key('rec:pending:', cameraId))) === 1
  } catch {
    return false
  }
}

/**
 * Lista todas as câmeras ativas no Redis (cross-replica).
 * Usado pelo reconcile para não duplicar gravações.
 * Nota: HSCAN seria mais eficiente mas SET individual é mais simples de
 * manter com TTL por câmera. Em escala (>10k cams) trocar por HSET com
 * campo por câmera + TTL gerenciado externamente.
 */
export async function listActiveCameraIds(): Promise<Set<string>> {
  try {
    const redis = getRedis()
    // KEYS com padrão — caro em prod, aceitável para <1000 câmeras.
    // Para escala: migrar para HSET recorder:active com hgetall.
    // O prefixo 'icv:' é adicionado automaticamente pelo keyPrefix do cliente,
    // mas KEYS/SCAN precisam do prefixo explícito no padrão.
    const keys = await redis.keys('rec:active:*')
    return new Set(keys.map(k => k.replace('rec:active:', '')))
  } catch {
    return new Set()
  }
}
