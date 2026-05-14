/**
 * pgvector-store-helpers — funções puras testáveis sem Postgres.
 *
 * Separadas do `pgvector-store.ts` (que depende de Prisma client) para
 * facilitar testes unitários e reuso em outras implementações de
 * IVectorStore (ex: Qdrant também precisa de z-score merge).
 */

import { EMBEDDING_DIM } from './types'
import type { RawVecHit, SearchModality, TenantScope, ZScoreStats } from './types'

// =============================================================================
// Serialização de Float32Array → string pgvector
// =============================================================================
// pgvector aceita literal '[0.1,0.2,...]' em string para INSERT/comparação.
// Para query params binárias, há protocolo binário, mas o overhead de string
// é negligenciável em 768 floats (~5KB) e simplifica debugging de SQL.

/**
 * Converte Float32Array para string compatível com pgvector ('[a,b,c]').
 * Rejeita NaN/Infinity (causariam erro no Postgres).
 *
 * Usa precisão de 7 dígitos significativos (limite real do Float32) para
 * evitar ruído na string (`0.10000000149011612` → `0.1`). pgvector tolera
 * ambas representações; usar a mais curta reduz tamanho do payload SQL.
 */
export function toVectorLiteral(v: Float32Array): string {
  if (v.length === 0) throw new Error('Cannot serialize empty vector')
  const parts: string[] = []
  for (let i = 0; i < v.length; i++) {
    const x = v[i]
    if (!Number.isFinite(x)) {
      throw new Error(`Cannot serialize NaN or Infinity at index ${i}: ${x}`)
    }
    // toPrecision(7) preserva precisão real do Float32 sem ruído IEEE.
    // parseFloat remove zeros à direita ("0.1000000" → "0.1").
    parts.push(parseFloat(x.toPrecision(7)).toString())
  }
  return `[${parts.join(',')}]`
}

// =============================================================================
// Cosine distance (Python/numpy compat)
// =============================================================================
// Não usamos esse em runtime (pgvector calcula no DB), apenas em:
//  - testes
//  - z-score offline em backfill
//  - debug

/**
 * Distância cosseno: 1 - (a · b) / (||a|| × ||b||).
 * Range: [0, 2]. 0 = idêntico, 1 = ortogonal, 2 = oposto.
 * Mesmo que `vector_cosine_ops` do pgvector.
 */
export function cosineDistance(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`)
  }
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 1
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb))
}

// =============================================================================
// Z-score normalization e merge multimodal
// =============================================================================
// Resolve o problema de escalas: cosine distance de embeddings textuais e
// visuais vivem em ranges diferentes. Sem normalizar, uma modalidade sempre
// "ganha" — perdemos sinal.
//
// Algoritmo: para cada hit, z = (distance - mean[modality]) / sqrt(variance).
// Hits com z menor são mais relevantes RELATIVAMENTE à sua modalidade.
//
// Stats mantidos por integrador (não global como o Frigate) — isolation.

/** Z-score de um valor dado mean/variance. */
function zScore(value: number, stats: ZScoreStats): number {
  if (stats.n === 0 || stats.variance === 0) return value  // fallback raw
  return (value - stats.mean) / Math.sqrt(stats.variance)
}

/**
 * Faz merge de hits de duas modalidades, preservando a modalidade que tem
 * menor z-score para cada frameId. Resultado ordenado ascendente por z.
 */
export function mergeWithZScore(
  captionHits: RawVecHit[],
  imageHits: RawVecHit[],
  captionStats: ZScoreStats,
  imageStats: ZScoreStats,
): Array<RawVecHit & { zScore: number }> {
  const merged = new Map<string, RawVecHit & { zScore: number }>()

  for (const hit of captionHits) {
    const z = zScore(hit.distance, captionStats)
    merged.set(hit.frameId, { ...hit, zScore: z })
  }

  for (const hit of imageHits) {
    const z = zScore(hit.distance, imageStats)
    const existing = merged.get(hit.frameId)
    if (!existing || z < existing.zScore) {
      merged.set(hit.frameId, { ...hit, zScore: z })
    }
  }

  return Array.from(merged.values()).sort((a, b) => a.zScore - b.zScore)
}

/**
 * Welch online update — mantém mean/variance incrementalmente sem armazenar
 * todas as distâncias. Usado pelo SearchService a cada query multimodal.
 */
export function welchUpdate(
  stats: ZScoreStats,
  newValues: number[],
): ZScoreStats {
  let { mean, variance, n } = stats
  // Variance armazenada como variance populacional; Welch usa M2 (sum of squared diffs).
  let m2 = variance * Math.max(1, n)
  for (const x of newValues) {
    n += 1
    const delta = x - mean
    mean += delta / n
    m2 += delta * (x - mean)
  }
  return {
    integradorId: stats.integradorId,
    modality: stats.modality,
    mean,
    variance: n > 0 ? m2 / n : 1,
    n,
  }
}

// =============================================================================
// SQL builder para WHERE com tenant scope
// =============================================================================
// Função pura — devolve fragmento SQL e params. Caller faz o resto da query.
// Garante por construção que toda busca tem scope ou é explicitamente cross-tenant.

export interface ScopeWhereOutput {
  /** Fragmento SQL pronto pra concatenar (após WHERE ou AND). */
  sql: string
  /** Params posicionais ($1, $2...) na ordem em que aparecem no SQL. */
  params: unknown[]
}

/**
 * Constrói cláusula WHERE para tenant isolation.
 *
 * - SUPER_ADMIN cross-tenant (`isCrossTenant=true` E ambos ids null): nenhum filtro.
 * - integradorId presente: `WHERE "integradorId" = $N`.
 * - clienteFinalId presente: `WHERE "clienteFinalId" = $N`.
 * - cameraIds presente: AND `"cameraId" = ANY($N+1)`.
 * - cameraIds vazio: força `1=0` (nenhum resultado) — defesa contra lista vazia bug.
 *
 * Convenção: placeholders começam em $1 — caller renumera se concatenar com outros params.
 */
export function buildScopeWhere(scope: TenantScope): ScopeWhereOutput {
  const conditions: string[] = []
  const params: unknown[] = []

  // Tenant principal (integradorId OU clienteFinalId)
  if (scope.clienteFinalId !== null) {
    params.push(scope.clienteFinalId)
    conditions.push(`"clienteFinalId" = $${params.length}`)
  } else if (scope.integradorId !== null) {
    params.push(scope.integradorId)
    conditions.push(`"integradorId" = $${params.length}`)
  } else if (!scope.isCrossTenant) {
    // Sem scope E sem cross-tenant flag = bug do caller, refuse explicitamente
    throw new Error(
      'buildScopeWhere: TenantScope vazio sem isCrossTenant. ' +
      'Use applyTenantScope() para construir TenantScope, nunca manual.',
    )
  }

  // Camera scope
  if (scope.cameraIds !== null) {
    if (scope.cameraIds.length === 0) {
      // Lista vazia explicita = retornar nada (não TRUE, que seria leak)
      conditions.push('1 = 0')
    } else {
      params.push(scope.cameraIds)
      conditions.push(`"cameraId" = ANY($${params.length})`)
    }
  }

  return {
    sql: conditions.length > 0 ? conditions.join(' AND ') : 'TRUE',
    params,
  }
}

// =============================================================================
// Validation helpers
// =============================================================================

export function assertEmbeddingDim(v: Float32Array, name: string): void {
  if (v.length !== EMBEDDING_DIM) {
    throw new Error(
      `${name}: dimensão esperada ${EMBEDDING_DIM}, recebido ${v.length}. ` +
      `Modelo deve produzir embeddings ${EMBEDDING_DIM}d (config: outputDimensionality).`,
    )
  }
}

/** Modality presente em hits? Útil para validar input em mergeWithZScore. */
export function hitsBySource(hits: RawVecHit[], source: SearchModality): RawVecHit[] {
  return hits.filter(h => h.source === source)
}
