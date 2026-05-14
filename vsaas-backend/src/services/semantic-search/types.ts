/**
 * Semantic Search — tipos compartilhados.
 *
 * Define o contrato entre worker de embedding, vector store, search audit
 * e endpoints HTTP. Mantém o resto do código tipo-seguro e tenant-isolated
 * por construção.
 *
 * Convenções:
 * - `Float32Array` para embeddings (não `number[]`) — saves memory + força
 *   o caller a tratar como vetor binário, não array genérico.
 * - Datas como `Date` (Prisma converte para timestamptz automaticamente).
 * - `TenantScope` é parâmetro NOMEADO em toda função de search — evita
 *   esquecer scoping por acidente.
 *
 * Ver docs/semantic-search/isolation-strategy.md.
 */

/** Dimensão dos embeddings — fixa por enquanto. */
export const EMBEDDING_DIM = 768

/** Modelo de embedding em uso. Persistido em DetectionFrame.embeddingModel. */
export const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001'

/** Modalidade da busca — qual coluna do DetectionFrame consultar. */
export type SearchModality = 'caption' | 'image' | 'merge'

/**
 * Escopo de tenant. Pelo menos UM dos `integradorId`/`clienteFinalId` deve
 * estar presente, exceto para SUPER_ADMIN cross-tenant onde ambos podem ser
 * `null` (caso auditado especialmente).
 *
 * Construído via `applyTenantScope()` — NUNCA monte manual num endpoint.
 */
export interface TenantScope {
  /** UUID do integrador. `null` apenas com SUPER_ADMIN. */
  integradorId: string | null
  /** UUID do cliente final. `null` para INTEGRADOR/SUPER. */
  clienteFinalId: string | null
  /**
   * Filtro adicional por câmeras autorizadas.
   * `null` = sem filtro (default p/ INTEGRADOR_ADMIN, SUPER).
   * Lista vazia = nenhuma câmera autorizada (resultado obrigatoriamente vazio).
   */
  cameraIds: string[] | null
  /**
   * Flag de auditoria: query cross-tenant (SUPER sem integradorId).
   * Frontend mostra warning, audit log marca metadata.cross_tenant=true.
   */
  isCrossTenant: boolean
}

/** Hit de busca semântica. */
export interface SearchHit {
  /** ID do DetectionFrame. */
  id: string
  /** Distância cosseno (0 = idêntico, 2 = oposto). Menor = mais similar. */
  distance: number
  /**
   * Confidence calculada via sigmoid(z-score) ou 1-distance dependendo do
   * modo. Sempre 0..1. Frontend exibe como percent.
   */
  confidence: number
  /** Modalidade que produziu este hit (em busca merge). */
  source: SearchModality
  /** Metadados do frame para hidratar UI. */
  cameraId: string
  cameraName: string | null
  siteId: string
  siteName: string | null
  clienteFinalId: string
  clienteFinalName: string | null
  integradorId: string
  timestamp: Date
  objectType: string
  bboxX: number
  bboxY: number
  bboxW: number
  bboxH: number
  captionText: string | null
  thumbnailKey: string | null
}

/** Payload para upsert de embeddings. */
export interface UpsertEmbeddingsInput {
  frameId: string
  captionText?: string
  captionEmbedding?: Float32Array
  imageEmbedding?: Float32Array
  embeddingModel?: string
  embeddingVersion?: number
}

/** Stats persistidas por integrador × modalidade. */
export interface ZScoreStats {
  integradorId: string
  modality: 'caption' | 'image'
  mean: number
  variance: number
  n: number
}

/** Resultado bruto do vec query (pré-normalização). */
export interface RawVecHit {
  frameId: string
  distance: number
  source: SearchModality
}
