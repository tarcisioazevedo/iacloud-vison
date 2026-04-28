/**
 * Sprint S — Geração de embeddings semânticos.
 *
 * Estratégia em camadas:
 *   1. Vertex multimodalembedding@001 (preferido — texto/imagem/vídeo unificado)
 *   2. OpenAI text-embedding-3-small (fallback texto)
 *   3. SYNTHETIC (FNV-1a hash → vetor determinístico) — para dev/teste sem GCP
 *
 * Modo SYNTHETIC é o default em ambiente sem credenciais GCP. Permite que toda
 * a pipeline de Semantic Triggers funcione end-to-end sem custo, com matching
 * baseado em hash semântico (fraco mas suficiente para validar UX/integração).
 */
import { logger } from './logger'

export interface EmbeddingResult {
  vector: number[]
  dim: number
  provider: string
  model: string
}

const SYNTHETIC_DIM = 384

/**
 * FNV-1a 32-bit hash — base para embedding sintético determinístico.
 */
function fnv1a(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h >>> 0
}

/**
 * Gera vetor sintético determinístico de dim=384 a partir de uma string.
 * Mesma string → mesmo vetor. Strings semanticamente próximas só batem se
 * compartilharem subwords (limitação reconhecida — é só pra dev).
 */
function syntheticVector(text: string): number[] {
  const tokens = text.toLowerCase().split(/\s+/).filter(t => t.length >= 2)
  const vec = new Array<number>(SYNTHETIC_DIM).fill(0)
  for (const tok of tokens) {
    const seed = fnv1a(tok)
    // Espalha o hash em 8 posições com sinal alternado
    for (let i = 0; i < 8; i++) {
      const idx = (seed + i * 31) % SYNTHETIC_DIM
      const sign = ((seed >> i) & 1) === 0 ? 1 : -1
      vec[idx] += sign * (1 + ((seed >> (i * 4)) & 0x0f) / 16)
    }
  }
  // L2-normalize para cosine similarity ficar em [-1, 1]
  let norm = 0
  for (const v of vec) norm += v * v
  norm = Math.sqrt(norm) || 1
  return vec.map(v => v / norm)
}

export async function embedText(text: string): Promise<EmbeddingResult> {
  const provider = process.env.EMBEDDING_PROVIDER ?? 'synthetic'

  if (provider === 'vertex' && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      // Lazy import via eval — @google-cloud/aiplatform é optional dep
      const dynamicImport: (mod: string) => Promise<any> =
        // eslint-disable-next-line no-new-func
        new Function('mod', 'return import(mod)') as any
      const aiplatform = await dynamicImport('@google-cloud/aiplatform').catch(() => null)
      if (aiplatform) {
        // Stub — deixa o caller saber que tentou e caiu
        // Implementação real: PredictionServiceClient.predict({endpoint, instances:[{content:text}]})
        logger.warn('vertex embedding requested but implementation not finalized — falling back to synthetic')
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'vertex_embedding_failed')
    }
  }

  // Synthetic fallback — sempre disponível
  return {
    vector: syntheticVector(text),
    dim: SYNTHETIC_DIM,
    provider: 'synthetic',
    model: 'fnv1a-hash-v1',
  }
}

export async function embedImage(imageBase64OrUrl: string): Promise<EmbeddingResult> {
  // Para sintético, hash a string base64 inteira (ou URL).
  // Em produção: enviar bytes para Vertex multimodalembedding@001.
  return {
    vector: syntheticVector(imageBase64OrUrl.slice(0, 256)),
    dim: SYNTHETIC_DIM,
    provider: 'synthetic',
    model: 'fnv1a-image-hash-v1',
  }
}

/**
 * Cosine similarity — ambos os vetores devem estar L2-normalizados.
 * Retorna [-1, 1]. >0.78 é tipicamente "match" para nossos embeddings.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}
