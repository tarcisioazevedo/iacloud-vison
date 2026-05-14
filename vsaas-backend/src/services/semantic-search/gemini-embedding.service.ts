/**
 * GeminiEmbeddingService — wrapper sobre `@google/generative-ai` para
 * gerar embeddings via `gemini-embedding-001` (GA, 2026-Q1).
 *
 * Responsabilidades:
 *  - Validar input (texto vazio, muito longo)
 *  - Truncar Matryoshka 3072 → 768 dims (configurável)
 *  - L2-normalizar (cosine distance = 1 - dot product após normalize)
 *  - Cache LRU para queries repetidas (3-5x economia em search)
 *  - Retry exponencial em 429/5xx (3 tentativas)
 *  - Graceful degradation sem API key (todos métodos lançam erro claro)
 *  - Modo testável via injeção de client mockado
 *
 * Custo (preço público 2026-Q2):
 *  - $0.025 / 1M tokens de entrada
 *  - Texto curto (caption ~30 tokens): ~$0.001 por 1k embeddings
 *  - 100k embeddings/mês ≈ $0.10
 *
 * Ver docs/semantic-search/.
 */

import fs from 'node:fs'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { logger } from '../../lib/logger'
import { EMBEDDING_DIM } from './types'

// =============================================================================
// Public helpers (testable)
// =============================================================================

/**
 * Normalização L2: divide por ||v||. Saída tem norma 1.
 * Sob L2-normalize, cosine_distance(a,b) = 1 - dot(a,b) — útil para
 * indexes pgvector com cosine_ops.
 */
export function l2Normalize(v: Float32Array): Float32Array {
  let sum = 0
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i]
  const norm = Math.sqrt(sum)
  if (norm === 0) return new Float32Array(v) // vetor zero, evita NaN
  const out = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm
  return out
}

/**
 * Truncamento Matryoshka — usa primeiros N dims do vetor.
 * Modelos Matryoshka (incluindo gemini-embedding-001) treinam prefixos
 * para que truncamento mantenha qualidade. Perda típica < 1% para
 * 3072 → 768.
 *
 * Ver: https://ai.google.dev/gemini-api/docs/embeddings#matryoshka
 */
export function truncateMatryoshka(v: Float32Array, target: number): Float32Array {
  if (target <= 0) throw new Error('target dim must be positive')
  if (v.length <= target) return v
  return v.slice(0, target)
}

// =============================================================================
// LRU Cache simples (sem dep externa para reduzir surface área)
// =============================================================================

class LruCache<K, V> {
  private map = new Map<K, V>()
  constructor(private maxSize: number) {}
  get(k: K): V | undefined {
    if (!this.map.has(k)) return undefined
    const v = this.map.get(k)!
    this.map.delete(k)
    this.map.set(k, v) // move to end (most recent)
    return v
  }
  set(k: K, v: V): void {
    if (this.map.has(k)) this.map.delete(k)
    this.map.set(k, v)
    if (this.map.size > this.maxSize) {
      const firstKey = this.map.keys().next().value
      if (firstKey !== undefined) this.map.delete(firstKey)
    }
  }
  get size(): number { return this.map.size }
  clear(): void { this.map.clear() }
}

// =============================================================================
// Configuração
// =============================================================================

const MAX_INPUT_LEN = 10_000 // chars; gemini-embedding-001 aceita até ~32k tokens
const CACHE_SIZE = 1_000      // queries únicas em cache; 1k × ~5KB = 5MB
const MAX_RETRIES = 3
const DEFAULT_BACKOFF_MS = 500

/** Lê API key de env var ou Docker secret. */
function readDefaultApiKey(): string {
  const env = process.env.GEMINI_API_KEY?.trim()
  if (env) return env
  try {
    return fs.readFileSync('/run/secrets/gemini_api_key', 'utf-8').trim()
  } catch {
    return ''
  }
}

export interface GeminiEmbeddingOptions {
  apiKey?: string
  model?: string
  /** Para testes: injeta um client mockado (com método `embedContent`). */
  _injectedClient?: { embedContent: (req: any) => Promise<any> }
  /** Para testes: backoff inicial em ms (default 500). */
  _testBackoffMs?: number
}

// =============================================================================
// Service
// =============================================================================

export class GeminiEmbeddingService {
  private apiKey: string
  private model: string
  private client: { embedContent: (req: any) => Promise<any> } | null
  private cache = new LruCache<string, Float32Array>(CACHE_SIZE)
  private backoffMs: number

  constructor(opts: GeminiEmbeddingOptions = {}) {
    this.apiKey = opts.apiKey ?? readDefaultApiKey()
    this.model = opts.model ?? 'gemini-embedding-001'
    this.backoffMs = opts._testBackoffMs ?? DEFAULT_BACKOFF_MS

    if (opts._injectedClient) {
      this.client = opts._injectedClient
    } else if (this.apiKey) {
      const genai = new GoogleGenerativeAI(this.apiKey)
      const m = genai.getGenerativeModel({ model: this.model })
      // SDK retorna { embedding: { values: number[] } }
      this.client = {
        embedContent: (req: any) => m.embedContent(req),
      }
    } else {
      this.client = null
    }
  }

  isAvailable(): boolean {
    return this.client !== null
  }

  /**
   * Gera embedding para uma string. Retorna Float32Array(768) L2-normalizado.
   *
   * @throws Error se string vazia, muito longa, ou API indisponível.
   */
  async embed(text: string): Promise<Float32Array> {
    if (text.length === 0) throw new Error('Cannot embed empty string')
    if (text.length > MAX_INPUT_LEN) {
      throw new Error(`Input too long: ${text.length} chars (max ${MAX_INPUT_LEN})`)
    }
    if (!this.client) {
      throw new Error('GeminiEmbeddingService: missing API key')
    }

    // Cache hit?
    const cached = this.cache.get(text)
    if (cached) return cached

    const raw = await this.withRetry(() =>
      this.client!.embedContent({
        content: { parts: [{ text }] },
        // gemini-embedding-001 retorna 3072 nativo; nosso schema é 768
        outputDimensionality: EMBEDDING_DIM,
      }),
    )

    const values = raw?.embedding?.values
    if (!Array.isArray(values)) {
      throw new Error('Unexpected response shape: missing embedding.values')
    }

    // Float32Array.from garante tipo Float32Array<ArrayBuffer> consistente
    // (não Float32Array<ArrayBufferLike>, que o TS5 distingue agora).
    let out: Float32Array = Float32Array.from(values as number[])
    out = truncateMatryoshka(out, EMBEDDING_DIM)
    out = l2Normalize(out)

    this.cache.set(text, out)
    return out
  }

  /**
   * Versão batch. Por enquanto sequencial — o SDK não tem batch nativo de
   * 1 chamada/N textos. Roda em paralelo limitado.
   */
  async embedBatch(texts: string[], opts: { concurrency?: number } = {}): Promise<Float32Array[]> {
    const concurrency = opts.concurrency ?? 5
    const results: Float32Array[] = new Array(texts.length)
    let i = 0
    async function worker(this: GeminiEmbeddingService) {
      while (i < texts.length) {
        const idx = i++
        results[idx] = await this.embed(texts[idx])
      }
    }
    const workers = Array.from({ length: concurrency }, () => worker.call(this))
    await Promise.all(workers)
    return results
  }

  // ─── Helpers privados ──────────────────────────────────────────────────────

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn()
      } catch (e) {
        lastErr = e
        const status = (e as any)?.status ?? (e as any)?.code
        const retriable = status === 429 || (typeof status === 'number' && status >= 500)
        if (!retriable || attempt === MAX_RETRIES) {
          logger.warn({ attempt, status, err: String(e) }, 'gemini_embed_failed')
          throw e
        }
        const wait = this.backoffMs * Math.pow(2, attempt - 1)
        await new Promise(resolve => setTimeout(resolve, wait))
      }
    }
    throw lastErr
  }

  /** Para debug/health: estatísticas do cache. */
  stats() {
    return {
      available: this.isAvailable(),
      cacheSize: this.cache.size,
      cacheMax: CACHE_SIZE,
      model: this.model,
    }
  }
}

// =============================================================================
// Instância singleton para uso runtime (lazy)
// =============================================================================

let _singleton: GeminiEmbeddingService | null = null

/**
 * Singleton lazy. Use em runtime — testes devem instanciar diretamente
 * `new GeminiEmbeddingService({ _injectedClient })` para isolamento.
 */
export function getGeminiEmbeddingService(): GeminiEmbeddingService {
  if (!_singleton) _singleton = new GeminiEmbeddingService()
  return _singleton
}
