/**
 * OpenAI Embedding Service — paralelo ao gemini-embedding.service.ts.
 *
 * Usa `text-embedding-3-small` com `dimensions: 768` (Matryoshka-friendly:
 * pega os primeiros 768 dims do vetor nativo 1536D). Compatível em DIMENSÃO
 * com o índice atual mas NÃO no espaço vetorial — vetores OpenAI e Gemini
 * não devem ser comparados entre si. Use `provider` column ou `LLM_PROVIDER`
 * env pra segregar buscas.
 *
 * Custo: $0.02 / 1M tokens. ~100k embeddings de captions curtas ≈ $0.06.
 *
 * API key: OPENAI_API_KEY env ou /run/secrets/openai_api_key.
 */

import fs from 'node:fs'
import OpenAI from 'openai'
import { logger } from '../../lib/logger'
import { EMBEDDING_DIM } from './types'

const MODEL_EMBED   = process.env.OPENAI_EMBED_MODEL ?? 'text-embedding-3-small'
const MAX_INPUT_LEN = 10_000
const CACHE_SIZE    = 1_000
const MAX_RETRIES   = 3
const DEFAULT_BACKOFF_MS = 500

function readApiKey(): string {
  const env = process.env.OPENAI_API_KEY?.trim()
  if (env) return env
  try { return fs.readFileSync('/run/secrets/openai_api_key', 'utf-8').trim() }
  catch { return '' }
}

export function l2Normalize(v: Float32Array): Float32Array {
  let sum = 0
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i]
  const norm = Math.sqrt(sum)
  if (norm === 0) return new Float32Array(v)
  const out = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm
  return out
}

class LruCache<K, V> {
  private map = new Map<K, V>()
  constructor(private maxSize: number) {}
  get(k: K): V | undefined {
    if (!this.map.has(k)) return undefined
    const v = this.map.get(k)!
    this.map.delete(k); this.map.set(k, v)
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
}

export class OpenAIEmbeddingService {
  private client: OpenAI | null
  private model: string
  private cache = new LruCache<string, Float32Array>(CACHE_SIZE)

  constructor(opts: { apiKey?: string; model?: string } = {}) {
    const key = opts.apiKey ?? readApiKey()
    this.model = opts.model ?? MODEL_EMBED
    this.client = key ? new OpenAI({ apiKey: key }) : null
  }

  isAvailable(): boolean { return this.client !== null }

  async embed(text: string): Promise<Float32Array> {
    if (text.length === 0) throw new Error('Cannot embed empty string')
    if (text.length > MAX_INPUT_LEN) throw new Error(`Input too long: ${text.length}`)
    if (!this.client) throw new Error('OpenAIEmbeddingService: missing API key')

    const cached = this.cache.get(text)
    if (cached) return cached

    const values = await this.withRetry(async () => {
      const r = await this.client!.embeddings.create({
        model:      this.model,
        input:      text,
        dimensions: EMBEDDING_DIM,
      })
      return r.data[0]?.embedding
    })

    if (!Array.isArray(values)) throw new Error('Unexpected response: missing embedding')

    // OpenAI já retorna L2-normalized quando `dimensions` é menor que o nativo,
    // mas garantimos pra cobrir versão futura.
    const out = l2Normalize(Float32Array.from(values))
    this.cache.set(text, out)
    return out
  }

  async embedBatch(texts: string[], opts: { concurrency?: number } = {}): Promise<Float32Array[]> {
    const concurrency = opts.concurrency ?? 5
    const results: Float32Array[] = new Array(texts.length)
    let i = 0
    const worker = async () => {
      while (i < texts.length) {
        const idx = i++
        results[idx] = await this.embed(texts[idx])
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()))
    return results
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try { return await fn() }
      catch (e) {
        lastErr = e
        const status = (e as any)?.status ?? (e as any)?.code
        const retriable = status === 429 || (typeof status === 'number' && status >= 500)
        if (!retriable || attempt === MAX_RETRIES) {
          logger.warn({ attempt, status, err: String(e) }, 'openai_embed_failed')
          throw e
        }
        const wait = DEFAULT_BACKOFF_MS * Math.pow(2, attempt - 1)
        await new Promise(r => setTimeout(r, wait))
      }
    }
    throw lastErr
  }

  stats() {
    return {
      available: this.isAvailable(),
      cacheSize: this.cache.size,
      cacheMax:  CACHE_SIZE,
      model:     this.model,
    }
  }
}

let _singleton: OpenAIEmbeddingService | null = null
export function getOpenAIEmbeddingService(): OpenAIEmbeddingService {
  if (!_singleton) _singleton = new OpenAIEmbeddingService()
  return _singleton
}
