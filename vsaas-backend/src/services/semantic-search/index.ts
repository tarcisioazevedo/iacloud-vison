/**
 * semantic-search — barrel exports.
 *
 * Use sempre `import { X } from '../services/semantic-search'` — nunca
 * importe arquivos internos. Mantém superfície pública estável quando
 * refatoramos internals (ex: trocar pgvector por Qdrant).
 *
 * Ver docs/semantic-search/ para visão arquitetural.
 */

// Tipos públicos
export type {
  TenantScope,
  SearchModality,
  SearchHit,
  UpsertEmbeddingsInput,
  ZScoreStats,
  RawVecHit,
} from './types'
export { EMBEDDING_DIM, DEFAULT_EMBEDDING_MODEL } from './types'

// Interface + implementação padrão (pgvector)
export type { IVectorStore } from './vector-store.interface'
export { PgVectorStore } from './pgvector-store'

// Helpers exportados para reuso (Qdrant impl futura, jobs admin)
export {
  toVectorLiteral,
  cosineDistance,
  mergeWithZScore,
  welchUpdate,
  buildScopeWhere,
  assertEmbeddingDim,
} from './pgvector-store-helpers'

// Embedding service
export {
  GeminiEmbeddingService,
  getGeminiEmbeddingService,
  l2Normalize,
  truncateMatryoshka,
} from './gemini-embedding.service'

// Tenant isolation helper (use em TODO endpoint de search)
export {
  applyTenantScope,
  TenantScopeError,
  type AuthContext,
  type ScopeInput,
} from './tenant-scope'

// Audit
export {
  SearchAuditService,
  getSearchAuditService,
  hashQuery,
} from './search-audit.service'

// Caption worker (PR2)
export {
  CaptionWorker,
  type CaptionWorkerDeps,
  type CaptionWorkerConfig,
  type BatchResult,
} from './caption-worker.service'
export {
  getCaptionWorker,
  startCaptionWorkerIfEnabled,
  stopCaptionWorker,
} from './caption-worker.bootstrap'
