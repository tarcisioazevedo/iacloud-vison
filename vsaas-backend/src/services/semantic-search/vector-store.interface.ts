/**
 * IVectorStore — contrato abstrato de storage de embeddings.
 *
 * Permite trocar pgvector ↔ Qdrant ↔ outros sem refatorar callers.
 * Implementações:
 *  - `PgVectorStore`   (atual, padrão)
 *  - `QdrantStore`     (futuro, quando volume > 5M ou p95 > 200ms)
 *
 * Toda função de leitura recebe `TenantScope` como parâmetro nomeado
 * obrigatório — defesa contra esquecer isolamento.
 *
 * Ver docs/semantic-search/qdrant-vs-pgvector.md para análise de decisão.
 */

import type {
  TenantScope,
  SearchModality,
  SearchHit,
  UpsertEmbeddingsInput,
} from './types'

export interface IVectorStore {
  // ─── Indexação ────────────────────────────────────────────────────────────

  /**
   * Insere ou atualiza embeddings de uma DetectionFrame.
   * Atómico (transação). Falha se `frameId` não existe.
   *
   * Multi-tenant: o frame já tem integradorId/clienteFinalId denormalizados,
   * não precisa passar scope no upsert (vem do registro).
   */
  upsert(input: UpsertEmbeddingsInput): Promise<void>

  /** Versão batch para reindex. Mesma transação até falhar. */
  upsertBatch(inputs: UpsertEmbeddingsInput[]): Promise<void>

  // ─── Busca ────────────────────────────────────────────────────────────────

  /**
   * Busca semântica. SEMPRE filtra pelo TenantScope — não é opcional.
   *
   * @param queryEmbedding embedding do texto/imagem buscado (dim = 768)
   * @param opts.modality 'caption' | 'image' | 'merge'
   *   - merge: roda nos dois e faz z-score merge (estilo Frigate)
   * @param opts.tenantScope scope construído via applyTenantScope()
   * @param opts.limit max hits (default 25, hard cap 100)
   */
  search(
    queryEmbedding: Float32Array,
    opts: {
      modality: SearchModality
      tenantScope: TenantScope
      fromDate?: Date
      toDate?: Date
      limit?: number
    },
  ): Promise<SearchHit[]>

  /**
   * "Find similar" — usa o embedding de um frame existente como query.
   * Útil para "encontre outros frames parecidos com este".
   *
   * Verifica acesso ao frame original via tenantScope antes de buscar.
   */
  searchSimilar(
    frameId: string,
    opts: {
      tenantScope: TenantScope
      modality: 'caption' | 'image'
      limit?: number
    },
  ): Promise<SearchHit[]>

  // ─── Exclusão ─────────────────────────────────────────────────────────────

  /**
   * Apaga TODOS os embeddings de um integrador (LGPD / cancelamento).
   * Não apaga o DetectionFrame em si — apenas zera embeddings + captionText.
   * Idempotente. Retorna quantos registros foram afetados.
   */
  deleteByIntegrador(integradorId: string): Promise<number>

  /** Idem por cliente final. */
  deleteByClienteFinal(clienteFinalId: string): Promise<number>

  // ─── Health ───────────────────────────────────────────────────────────────

  /**
   * Verifica conectividade + presença de extensão/índices.
   * Usado por GET /search/health e healthchecks do swarm.
   */
  health(): Promise<{
    ok: boolean
    backend: 'pgvector' | 'qdrant'
    indexesReady: boolean
    totalEmbeddings: number
    pendingCaption: number
    error?: string
  }>
}
